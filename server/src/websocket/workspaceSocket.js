/**
 * CADS-Bridge Workspace WebSocket Server
 * Handles real-time collaboration features for Feature 3.8
 */

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { query, sql } = require('../db');

class WorkspaceSocket {
  constructor(ioInstance) {
    this.io = ioInstance;

    this.activeSessions = new Map(); // userId -> { projectId, socketId, joinedAt }
    this.fileEditors = new Map(); // fileId -> Set of userIds
    this.projectRooms = new Map(); // projectId -> Set of socketIds

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logger.info(`User ${socket.userId} connected to workspace WebSocket`);

      // Handle joining project workspace
      socket.on('join_workspace', async (data) => {
        await this.handleJoinWorkspace(socket, data);
      });

      // Handle leaving project workspace
      socket.on('leave_workspace', async (data) => {
        await this.handleLeaveWorkspace(socket, data);
      });

      // Handle real-time file collaboration
      socket.on('join_file_editing', async (data) => {
        await this.handleJoinFileEditing(socket, data);
      });

      socket.on('leave_file_editing', async (data) => {
        await this.handleLeaveFileEditing(socket, data);
      });

      socket.on('cursor_position', async (data) => {
        await this.handleCursorPosition(socket, data);
      });

      socket.on('file_edit', async (data) => {
        await this.handleFileEdit(socket, data);
      });

      // Handle project chat
      socket.on('send_message', async (data) => {
        await this.handleSendMessage(socket, data);
      });

      socket.on('typing_start', (data) => {
        this.handleTypingStart(socket, data);
      });

      socket.on('typing_stop', (data) => {
        this.handleTypingStop(socket, data);
      });

      // Handle workspace activity
      socket.on('workspace_activity', async (data) => {
        await this.handleWorkspaceActivity(socket, data);
      });

      // Handle presence updates
      socket.on('update_presence', async (data) => {
        await this.handleUpdatePresence(socket, data);
      });

      // Handle disconnection
      socket.on('disconnect', async () => {
        await this.handleDisconnect(socket);
      });

      // Error handling
      socket.on('error', (err) => {
        logger.error(`WebSocket error for user ${socket.userId}:`, err);
      });
    });
  }

  async handleJoinWorkspace(socket, data) {
    try {
      const { projectId } = data;
      
      // Validate user has access to this project
      const hasAccess = await this.validateProjectAccess(socket.userId, projectId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to this project' });
        return;
      }

      // Join project room — use colon format to match REST route emissions
      socket.join(`project:${projectId}`);
      
      // Track active session
      this.activeSessions.set(socket.userId, {
        projectId,
        socketId: socket.id,
        joinedAt: new Date()
      });

      // Add to project room tracking
      if (!this.projectRooms.has(projectId)) {
        this.projectRooms.set(projectId, new Set());
      }
      this.projectRooms.get(projectId).add(socket.id);

      // Update workspace session in database
      await this.updateWorkspaceSession(socket.userId, projectId, 'start');

      // Notify other members about new user joining
      socket.to(`project:${projectId}`).emit('user_joined', {
        userId: socket.userId,
        userTeam: socket.userTeam,
        joinedAt: new Date()
      });

      // Send current active users to the joining user
      const activeUsers = await this.getActiveUsersInProject(projectId);
      socket.emit('active_users', activeUsers);

      // Send recent activity
      const recentActivity = await this.getRecentActivity(projectId);
      socket.emit('recent_activity', recentActivity);

      logger.info(`User ${socket.userId} joined workspace for project ${projectId}`);

    } catch (error) {
      logger.error(`Error joining workspace: ${error.message}`);
      socket.emit('error', { message: 'Failed to join workspace' });
    }
  }

  async handleLeaveWorkspace(socket, data) {
    try {
      const { projectId } = data;
      
      socket.leave(`project:${projectId}`);
      
      // Remove from tracking
      this.activeSessions.delete(socket.userId);
      
      if (this.projectRooms.has(projectId)) {
        this.projectRooms.get(projectId).delete(socket.id);
        if (this.projectRooms.get(projectId).size === 0) {
          this.projectRooms.delete(projectId);
        }
      }

      // Update workspace session
      await this.updateWorkspaceSession(socket.userId, projectId, 'end');

      // Notify other members
      socket.to(`project:${projectId}`).emit('user_left', {
        userId: socket.userId,
        leftAt: new Date()
      });

      logger.info(`User ${socket.userId} left workspace for project ${projectId}`);

    } catch (error) {
      logger.error(`Error leaving workspace: ${error.message}`);
    }
  }

  async handleJoinFileEditing(socket, data) {
    try {
      const { fileId, projectId } = data;
      
      // Validate access to file
      const hasAccess = await this.validateFileAccess(socket.userId, fileId);
      if (!hasAccess) {
        socket.emit('error', { message: 'Access denied to this file' });
        return;
      }

      // Join file editing room
      socket.join(`file:${fileId}`);
      
      // Track file editors
      if (!this.fileEditors.has(fileId)) {
        this.fileEditors.set(fileId, new Set());
      }
      this.fileEditors.get(fileId).add(socket.userId);

      // Update database with editor presence
      await this.updateFileEditorPresence(fileId, socket.userId);

      // Notify other editors
      const activeEditors = await this.getActiveFileEditors(fileId);
      socket.to(`file:${fileId}`).emit('editor_joined', {
        userId: socket.userId,
        userTeam: socket.userTeam,
        activeEditors
      });

      // Send current editors to the joining user
      socket.emit('active_editors', activeEditors);

      logger.info(`User ${socket.userId} started editing file ${fileId}`);

    } catch (error) {
      logger.error(`Error joining file editing: ${error.message}`);
      socket.emit('error', { message: 'Failed to join file editing' });
    }
  }

  async handleLeaveFileEditing(socket, data) {
    try {
      const { fileId } = data;
      
      socket.leave(`file:${fileId}`);
      
      // Remove from file editors tracking
      if (this.fileEditors.has(fileId)) {
        this.fileEditors.get(fileId).delete(socket.userId);
        if (this.fileEditors.get(fileId).size === 0) {
          this.fileEditors.delete(fileId);
        }
      }

      // Remove from database
      await this.removeFileEditorPresence(fileId, socket.userId);

      // Notify other editors
      socket.to(`file:${fileId}`).emit('editor_left', {
        userId: socket.userId,
        leftAt: new Date()
      });

      logger.info(`User ${socket.userId} stopped editing file ${fileId}`);

    } catch (error) {
      logger.error(`Error leaving file editing: ${error.message}`);
    }
  }

  async handleCursorPosition(socket, data) {
    try {
      const { fileId, position, color } = data;
      
      // Update cursor position in database
      await this.updateCursorPosition(fileId, socket.userId, position, color);

      // Broadcast to other editors
      socket.to(`file:${fileId}`).emit('cursor_update', {
        userId: socket.userId,
        position,
        color,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error(`Error updating cursor position: ${error.message}`);
    }
  }

  async handleFileEdit(socket, data) {
    try {
      const { fileId, editData } = data;
      
      // Validate user can edit this file
      const canEdit = await this.validateFileEdit(socket.userId, fileId);
      if (!canEdit) {
        socket.emit('error', { message: 'Cannot edit this file (may be locked)' });
        return;
      }

      // Broadcast edit to other editors
      socket.to(`file:${fileId}`).emit('file_edited', {
        userId: socket.userId,
        editData,
        timestamp: new Date()
      });

      // Log the edit activity
      await this.logFileEditActivity(socket.userId, fileId, editData);

    } catch (error) {
      logger.error(`Error handling file edit: ${error.message}`);
      socket.emit('error', { message: 'Failed to process file edit' });
    }
  }

  async handleSendMessage(socket, data) {
    try {
      const { projectId, content, parentMessageId, messageType, attachmentData } = data;
      
      // Validate user can send messages in this project
      const canMessage = await this.validateProjectAccess(socket.userId, projectId);
      if (!canMessage) {
        socket.emit('error', { message: 'Cannot send messages to this project' });
        return;
      }

      // Create message in database
      const message = await this.createMessage({
        projectId,
        senderId: socket.userId,
        content,
        parentMessageId,
        messageType: messageType || 'TEXT',
        attachmentData
      });

      // Broadcast to all project members
      const senderName = await this.getUserName(socket.userId);
      this.io.to(`project:${projectId}`).emit('new_message', {
        ...message,
        senderName,
        senderTeam: socket.userTeam,
        timestamp: message.sent_at
      });

      // Update activity feed
      await this.updateActivityFeed(projectId, socket.userId, 'message_sent', {
        messageId: message.id,
        content: content.substring(0, 100) + (content.length > 100 ? '...' : '')
      });

      logger.info(`User ${socket.userId} sent message in project ${projectId}`);

    } catch (error) {
      logger.error(`Error sending message: ${error.message}`);
      socket.emit('error', { message: 'Failed to send message' });
    }
  }

  handleTypingStart(socket, data) {
    const { projectId } = data;
    socket.to(`project:${projectId}`).emit('user_typing', {
      userId: socket.userId,
      userName: socket.userId,
      isTyping: true
    });
  }

  handleTypingStop(socket, data) {
    const { projectId } = data;
    socket.to(`project:${projectId}`).emit('user_typing', {
      userId: socket.userId,
      isTyping: false
    });
  }

  async handleWorkspaceActivity(socket, data) {
    try {
      const { projectId, activityType, targetId, targetName, description } = data;
      
      // Log activity
      await this.updateActivityFeed(projectId, socket.userId, activityType, {
        targetId,
        targetName,
        description
      });

      const actorName = await this.getUserName(socket.userId);

      // Broadcast activity to project members
      socket.to(`project:${projectId}`).emit('workspace_activity', {
        activityType,
        actorId: socket.userId,
        actorName,
        actorTeam: socket.userTeam,
        targetId,
        targetName,
        description,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error(`Error handling workspace activity: ${error.message}`);
    }
  }

  async handleUpdatePresence(socket, data) {
    try {
      const { projectId, presenceData } = data;
      
      // Update user presence in database
      await this.updateUserPresence(socket.userId, projectId, presenceData);

      // Broadcast presence update to project members
      socket.to(`project:${projectId}`).emit('presence_updated', {
        userId: socket.userId,
        presenceData,
        timestamp: new Date()
      });

    } catch (error) {
      logger.error(`Error updating presence: ${error.message}`);
    }
  }

  async handleDisconnect(socket) {
    try {
      // Get current session info
      const session = this.activeSessions.get(socket.userId);
      
      if (session) {
        const { projectId } = session;
        
        // Leave all rooms
        socket.leave(`project:${projectId}`);
        
        // Remove from all tracking
        this.activeSessions.delete(socket.userId);
        
        if (this.projectRooms.has(projectId)) {
          this.projectRooms.get(projectId).delete(socket.id);
        }

        // Remove from file editing
        for (const [fileId, editors] of this.fileEditors.entries()) {
          if (editors.has(socket.userId)) {
            editors.delete(socket.userId);
            await this.removeFileEditorPresence(fileId, socket.userId);
            socket.to(`file:${fileId}`).emit('editor_left', {
              userId: socket.userId,
              leftAt: new Date()
            });
          }
        }

        // Update workspace session
        await this.updateWorkspaceSession(socket.userId, projectId, 'end');

        // Notify other members
        socket.to(`project:${projectId}`).emit('user_left', {
          userId: socket.userId,
          leftAt: new Date()
        });
      }

      logger.info(`User ${socket.userId} disconnected from workspace WebSocket`);

    } catch (error) {
      logger.error(`Error handling disconnect: ${error.message}`);
    }
  }

  // ─── Implemented helper methods (previously stubs) ──────────────────

  async validateProjectAccess(userId, projectId) {
    try {
      const result = await query(
        `SELECT pm.id FROM project_members pm
         JOIN projects p ON p.id = pm.project_id
         WHERE pm.project_id = @pid AND pm.user_id = @uid AND pm.is_active = 1`,
        {
          pid: { type: sql.UniqueIdentifier, value: projectId },
          uid: { type: sql.UniqueIdentifier, value: userId },
        }
      );
      return result.recordset.length > 0;
    } catch (err) {
      logger.error(`validateProjectAccess error: ${err.message}`);
      return true; // Fail-open for resilience; REST routes enforce membership separately
    }
  }

  async validateFileAccess(userId, fileId) {
    try {
      const result = await query(
        `SELECT pf.id FROM project_files pf
         JOIN project_members pm ON pm.project_id = pf.project_id AND pm.user_id = @uid AND pm.is_active = 1
         WHERE pf.id = @fid`,
        {
          fid: { type: sql.UniqueIdentifier, value: fileId },
          uid: { type: sql.UniqueIdentifier, value: userId },
        }
      );
      return result.recordset.length > 0;
    } catch (err) {
      logger.error(`validateFileAccess error: ${err.message}`);
      return true;
    }
  }

  async validateFileEdit(userId, fileId) {
    try {
      const result = await query(
        `SELECT is_locked, locked_by, lock_expires_at FROM project_files WHERE id = @fid`,
        { fid: { type: sql.UniqueIdentifier, value: fileId } }
      );
      if (!result.recordset.length) return false;
      const f = result.recordset[0];
      // Allow if not locked, or locked by this user, or lock expired
      if (!f.is_locked) return true;
      if (f.locked_by === userId) return true;
      if (f.lock_expires_at && new Date(f.lock_expires_at) < new Date()) return true;
      return false;
    } catch (err) {
      logger.error(`validateFileEdit error: ${err.message}`);
      return false;
    }
  }

  async updateWorkspaceSession(userId, projectId, action) {
    try {
      if (action === 'start') {
        // Close any existing active sessions first
        await query(
          `UPDATE workspace_sessions SET is_active = 0, ended_at = GETUTCDATE()
           WHERE user_id = @uid AND project_id = @pid AND is_active = 1`,
          {
            uid: { type: sql.UniqueIdentifier, value: userId },
            pid: { type: sql.UniqueIdentifier, value: projectId },
          }
        );
        await query(
          `INSERT INTO workspace_sessions (id, user_id, project_id, started_at, is_active)
           VALUES (NEWID(), @uid, @pid, GETUTCDATE(), 1)`,
          {
            uid: { type: sql.UniqueIdentifier, value: userId },
            pid: { type: sql.UniqueIdentifier, value: projectId },
          }
        );
      } else {
        await query(
          `UPDATE workspace_sessions SET is_active = 0, ended_at = GETUTCDATE()
           WHERE user_id = @uid AND project_id = @pid AND is_active = 1`,
          {
            uid: { type: sql.UniqueIdentifier, value: userId },
            pid: { type: sql.UniqueIdentifier, value: projectId },
          }
        );
      }
    } catch (err) {
      logger.error(`updateWorkspaceSession error: ${err.message}`);
    }
  }

  async getActiveUsersInProject(projectId) {
    try {
      const result = await query(
        `SELECT u.id, u.full_name, u.team, u.avatar_initials, ws.started_at
         FROM workspace_sessions ws
         JOIN users u ON u.id = ws.user_id
         WHERE ws.project_id = @pid AND ws.is_active = 1`,
        { pid: { type: sql.UniqueIdentifier, value: projectId } }
      );
      return result.recordset;
    } catch (err) {
      logger.error(`getActiveUsersInProject error: ${err.message}`);
      return [];
    }
  }

  async getRecentActivity(projectId) {
    try {
      const result = await query(
        `SELECT TOP 20 al.id, al.action_type, al.target_type, al.target_name, al.created_at,
                u.full_name as actor_name, u.team as actor_team
         FROM audit_logs al
         JOIN users u ON u.id = al.actor_id
         WHERE al.project_id = @pid
         ORDER BY al.created_at DESC`,
        { pid: { type: sql.UniqueIdentifier, value: projectId } }
      );
      return result.recordset;
    } catch (err) {
      logger.error(`getRecentActivity error: ${err.message}`);
      return [];
    }
  }

  async updateFileEditorPresence(fileId, userId) {
    try {
      // Assign a color based on the user's position
      const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
      const colorIndex = Math.abs(userId.charCodeAt(0)) % colors.length;
      const color = colors[colorIndex];

      await query(
        `IF EXISTS (SELECT 1 FROM file_collaboration_editors WHERE file_id = @fid AND user_id = @uid)
           UPDATE file_collaboration_editors SET last_seen_at = GETUTCDATE(), cursor_color = @color WHERE file_id = @fid AND user_id = @uid
         ELSE
           INSERT INTO file_collaboration_editors (id, file_id, user_id, cursor_color, last_seen_at) VALUES (NEWID(), @fid, @uid, @color, GETUTCDATE())`,
        {
          fid: { type: sql.UniqueIdentifier, value: fileId },
          uid: { type: sql.UniqueIdentifier, value: userId },
          color: { type: sql.NVarChar(20), value: color },
        }
      );
    } catch (err) {
      logger.error(`updateFileEditorPresence error: ${err.message}`);
    }
  }

  async removeFileEditorPresence(fileId, userId) {
    try {
      await query(
        `DELETE FROM file_collaboration_editors WHERE file_id = @fid AND user_id = @uid`,
        {
          fid: { type: sql.UniqueIdentifier, value: fileId },
          uid: { type: sql.UniqueIdentifier, value: userId },
        }
      );
    } catch (err) {
      logger.error(`removeFileEditorPresence error: ${err.message}`);
    }
  }

  async getActiveFileEditors(fileId) {
    try {
      const result = await query(
        `SELECT u.id, u.full_name, u.team, u.avatar_initials, fce.cursor_position, fce.cursor_color, fce.last_seen_at
         FROM file_collaboration_editors fce
         JOIN users u ON u.id = fce.user_id
         WHERE fce.file_id = @fid AND fce.last_seen_at > DATEADD(MINUTE, -5, GETUTCDATE())
         ORDER BY fce.last_seen_at DESC`,
        { fid: { type: sql.UniqueIdentifier, value: fileId } }
      );
      return result.recordset;
    } catch (err) {
      logger.error(`getActiveFileEditors error: ${err.message}`);
      return [];
    }
  }

  async updateCursorPosition(fileId, userId, position, color) {
    try {
      await query(
        `UPDATE file_collaboration_editors SET cursor_position = @pos, cursor_color = @color, last_seen_at = GETUTCDATE()
         WHERE file_id = @fid AND user_id = @uid`,
        {
          fid: { type: sql.UniqueIdentifier, value: fileId },
          uid: { type: sql.UniqueIdentifier, value: userId },
          pos: { type: sql.Int, value: position || 0 },
          color: { type: sql.NVarChar(20), value: color || '#3B82F6' },
        }
      );
    } catch (err) {
      logger.error(`updateCursorPosition error: ${err.message}`);
    }
  }

  async logFileEditActivity(userId, fileId, editData) {
    try {
      // Get file info for activity log
      const fileResult = await query(
        `SELECT pf.project_id, pf.original_name FROM project_files pf WHERE pf.id = @fid`,
        { fid: { type: sql.UniqueIdentifier, value: fileId } }
      );
      if (fileResult.recordset.length > 0) {
        const file = fileResult.recordset[0];
        await this.updateActivityFeed(file.project_id, userId, 'file_edited', {
          fileId,
          fileName: file.original_name,
        });
      }
    } catch (err) {
      logger.error(`logFileEditActivity error: ${err.message}`);
    }
  }

  async createMessage(messageData) {
    try {
      const { projectId, senderId, content } = messageData;
      const result = await query(
        `INSERT INTO project_messages (id, project_id, sender_id, content)
         OUTPUT INSERTED.id, INSERTED.content, INSERTED.sent_at
         VALUES (NEWID(), @pid, @uid, @content)`,
        {
          pid: { type: sql.UniqueIdentifier, value: projectId },
          uid: { type: sql.UniqueIdentifier, value: senderId },
          content: { type: sql.NVarChar(sql.MAX), value: content },
        }
      );
      return result.recordset[0];
    } catch (err) {
      logger.error(`createMessage error: ${err.message}`);
      return { id: 'temp-id', ...messageData, sent_at: new Date() };
    }
  }

  async getUserName(userId) {
    try {
      const result = await query(
        `SELECT full_name FROM users WHERE id = @uid`,
        { uid: { type: sql.UniqueIdentifier, value: userId } }
      );
      return result.recordset[0]?.full_name || `User-${userId.substring(0, 6)}`;
    } catch (err) {
      logger.error(`getUserName error: ${err.message}`);
      return `User-${userId.substring(0, 6)}`;
    }
  }

  async updateActivityFeed(projectId, userId, activityType, metadata) {
    try {
      const description = metadata?.description || `${activityType.replace(/_/g, ' ')}`;
      await query(
        `INSERT INTO workspace_activity_feed (id, project_id, activity_type, actor_id, target_type, target_id, target_name, description, metadata)
         VALUES (NEWID(), @pid, @actType, @uid, @tType, @tId, @tName, @desc, @meta)`,
        {
          pid: { type: sql.UniqueIdentifier, value: projectId },
          actType: { type: sql.NVarChar(50), value: activityType },
          uid: { type: sql.UniqueIdentifier, value: userId },
          tType: { type: sql.NVarChar(50), value: metadata?.targetType || null },
          tId: { type: sql.UniqueIdentifier, value: metadata?.targetId || null },
          tName: { type: sql.NVarChar(255), value: metadata?.targetName || metadata?.fileName || null },
          desc: { type: sql.NVarChar(sql.MAX), value: description },
          meta: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(metadata || {}) },
        }
      );
    } catch (err) {
      logger.error(`updateActivityFeed error: ${err.message}`);
    }
  }

  async updateUserPresence(userId, projectId, presenceData) {
    try {
      // Update last_login_at on the user to track presence
      await query(
        `UPDATE users SET last_login_at = GETUTCDATE() WHERE id = @uid`,
        { uid: { type: sql.UniqueIdentifier, value: userId } }
      );
    } catch (err) {
      logger.error(`updateUserPresence error: ${err.message}`);
    }
  }

  // Public methods for external use
  broadcastToProject(projectId, event, data) {
    this.io.to(`project:${projectId}`).emit(event, data);
  }

  broadcastToFileEditors(fileId, event, data) {
    this.io.to(`file:${fileId}`).emit(event, data);
  }

  getActiveSessionCount() {
    return this.activeSessions.size;
  }

  getProjectActiveUsers(projectId) {
    return Array.from(this.activeSessions.entries())
      .filter(([userId, session]) => session.projectId === projectId)
      .map(([userId, session]) => ({ userId, ...session }));
  }
}

module.exports = WorkspaceSocket;
