/**
 * CADS-Bridge Workspace Models (Feature 3.8)
 * Additional database models for Shared Collaborative Project Workspace
 */

const sql = require('mssql');

// Workspace Activity Feed
const workspaceActivityQueries = {
  // Get recent activity for a project
  getRecentActivity: `
    SELECT 
      a.id,
      a.action_type,
      a.target_type,
      a.target_id,
      a.target_name,
      a.metadata,
      a.created_at,
      u.full_name as actor_name,
      u.team as actor_team,
      u.avatar_initials
    FROM audit_logs a
    JOIN users u ON a.actor_id = u.id
    WHERE a.env_id = @env_id 
      AND a.target_type IN ('file_upload', 'task_update', 'message_sent', 'annotation_added', 'conflict_detected', 'file_version_published')
      AND (
        a.target_id IN (
          SELECT CAST(id AS NVARCHAR(100)) FROM projects WHERE id = @project_id
        )
        OR a.metadata LIKE '%project_id%' + CAST(@project_id AS NVARCHAR(36)) + '%'
      )
    ORDER BY a.created_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `,

  // Log workspace activity
  logActivity: `
    INSERT INTO audit_logs (env_id, actor_id, action_type, target_type, target_id, target_name, metadata, ip_address)
    VALUES (@env_id, @actor_id, @action_type, @target_type, @target_id, @target_name, @metadata, @ip_address)
  `
};

// Project Messages with threading
const messageQueries = {
  // Get messages with threading info
  getMessages: `
    WITH MessageThread AS (
      SELECT 
        m.id,
        m.project_id,
        m.sender_id,
        m.content,
        m.sent_at,
        NULL as parent_message_id,
        0 as thread_level,
        ROW_NUMBER() OVER (ORDER BY m.sent_at DESC) as row_num
      FROM project_messages m
      WHERE m.project_id = @project_id 
        AND m.parent_message_id IS NULL
      
      UNION ALL
      
      SELECT 
        m.id,
        m.project_id,
        m.sender_id,
        m.content,
        m.sent_at,
        m.parent_message_id,
        1 as thread_level,
        ROW_NUMBER() OVER (ORDER BY m.sent_at DESC) as row_num
      FROM project_messages m
      WHERE m.project_id = @project_id 
        AND m.parent_message_id IS NOT NULL
    )
    SELECT 
      mt.*,
      u.full_name as sender_name,
      u.team as sender_team,
      u.avatar_initials
    FROM MessageThread mt
    JOIN users u ON mt.sender_id = u.id
    ORDER BY mt.sent_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `,

  // Send message
  sendMessage: `
    INSERT INTO project_messages (project_id, sender_id, content, parent_message_id)
    VALUES (@project_id, @sender_id, @content, @parent_message_id);
    
    SELECT SCOPE_IDENTITY() as new_message_id;
  `,

  // Search messages
  searchMessages: `
    SELECT 
      m.id,
      m.content,
      m.sent_at,
      u.full_name as sender_name,
      u.team as sender_team,
      CASE 
        WHEN m.parent_message_id IS NOT NULL THEN 
          (SELECT content FROM project_messages WHERE id = m.parent_message_id)
        ELSE NULL
      END as parent_content
    FROM project_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.project_id = @project_id
      AND m.content LIKE '%' + @search_term + '%'
    ORDER BY m.sent_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `
};

// File Co-editing and Presence
const fileCollaborationQueries = {
  // Get active editors for a file
  getActiveEditors: `
    SELECT 
      u.id,
      u.full_name,
      u.team,
      u.avatar_initials,
      fce.last_seen_at,
      fce.cursor_position,
      fce.cursor_color
    FROM file_collaboration_editors fce
    JOIN users u ON fce.user_id = u.id
    WHERE fce.file_id = @file_id
      AND fce.last_seen_at > DATEADD(MINUTE, -5, GETUTCDATE())
    ORDER BY fce.last_seen_at DESC
  `,

  // Update editor presence
  updateEditorPresence: `
    MERGE file_collaboration_editors AS target
    USING (VALUES (@file_id, @user_id, @cursor_position, @cursor_color, GETUTCDATE())) 
    AS source (file_id, user_id, cursor_position, cursor_color, last_seen_at)
    ON target.file_id = source.file_id AND target.user_id = source.user_id
    WHEN MATCHED THEN
      UPDATE SET 
        cursor_position = source.cursor_position,
        cursor_color = source.cursor_color,
        last_seen_at = source.last_seen_at
    WHEN NOT MATCHED THEN
      INSERT (file_id, user_id, cursor_position, cursor_color, last_seen_at)
      VALUES (source.file_id, source.user_id, source.cursor_position, source.cursor_color, source.last_seen_at);
  `,

  // Remove editor presence
  removeEditorPresence: `
    DELETE FROM file_collaboration_editors
    WHERE file_id = @file_id AND user_id = @user_id
  `,

  // Clean up stale editors
  cleanupStaleEditors: `
    DELETE FROM file_collaboration_editors
    WHERE last_seen_at < DATEADD(MINUTE, -10, GETUTCDATE())
  `
};

// Workspace Contribution Audit
const workspaceAuditQueries = {
  // Get contribution history for project
  getContributionHistory: `
    SELECT 
      a.id,
      a.action_type,
      a.target_type,
      a.target_id,
      a.target_name,
      a.metadata,
      a.created_at,
      u.full_name as actor_name,
      u.team as actor_team,
      u.avatar_initials
    FROM audit_logs a
    JOIN users u ON a.actor_id = u.id
    WHERE a.env_id = @env_id
      AND (
        a.target_id IN (
          SELECT CAST(id AS NVARCHAR(100)) FROM projects WHERE id = @project_id
        )
        OR a.metadata LIKE '%project_id%' + CAST(@project_id AS NVARCHAR(36)) + '%'
      )
      AND (@user_id IS NULL OR a.actor_id = @user_id)
      AND (@action_type IS NULL OR a.action_type = @action_type)
      AND (@date_from IS NULL OR a.created_at >= @date_from)
      AND (@date_to IS NULL OR a.created_at <= @date_to)
    ORDER BY a.created_at DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `,

  // Get contribution summary by user
  getContributionSummary: `
    SELECT 
      u.id as user_id,
      u.full_name,
      u.team,
      COUNT(*) as total_actions,
      COUNT(CASE WHEN a.action_type LIKE '%upload%' THEN 1 END) as file_uploads,
      COUNT(CASE WHEN a.action_type LIKE '%task%' THEN 1 END) as task_actions,
      COUNT(CASE WHEN a.action_type LIKE '%message%' THEN 1 END) as messages,
      COUNT(CASE WHEN a.action_type LIKE '%annotation%' THEN 1 END) as annotations,
      MIN(a.created_at) as first_activity,
      MAX(a.created_at) as last_activity
    FROM users u
    JOIN audit_logs a ON u.id = a.actor_id
    WHERE u.env_id = @env_id
      AND (
        a.target_id IN (
          SELECT CAST(id AS NVARCHAR(100)) FROM projects WHERE id = @project_id
        )
        OR a.metadata LIKE '%project_id%' + CAST(@project_id AS NVARCHAR(36)) + '%'
      )
      AND (@date_from IS NULL OR a.created_at >= @date_from)
      AND (@date_to IS NULL OR a.created_at <= @date_to)
    GROUP BY u.id, u.full_name, u.team
    ORDER BY total_actions DESC
  `,

  // Export contribution history
  exportContributionHistory: `
    SELECT 
      a.created_at as timestamp,
      u.full_name as actor_name,
      u.team as actor_team,
      a.action_type,
      a.target_type,
      a.target_name,
      a.metadata
    FROM audit_logs a
    JOIN users u ON a.actor_id = u.id
    WHERE a.env_id = @env_id
      AND (
        a.target_id IN (
          SELECT CAST(id AS NVARCHAR(100)) FROM projects WHERE id = @project_id
        )
        OR a.metadata LIKE '%project_id%' + CAST(@project_id AS NVARCHAR(36)) + '%'
      )
      AND (@user_id IS NULL OR a.actor_id = @user_id)
      AND (@action_type IS NULL OR a.action_type = @action_type)
      AND (@date_from IS NULL OR a.created_at >= @date_from)
      AND (@date_to IS NULL OR a.created_at <= @date_to)
    ORDER BY a.created_at DESC
  `
};

// Workspace Health Metrics
const workspaceHealthQueries = {
  // Get project health indicators
  getProjectHealth: `
    DECLARE @total_tasks INT = (SELECT COUNT(*) FROM tasks WHERE project_id = @project_id);
    DECLARE @completed_tasks INT = (SELECT COUNT(*) FROM tasks WHERE project_id = @project_id AND status = 'done');
    DECLARE @overdue_tasks INT = (
      SELECT COUNT(*) FROM tasks 
      WHERE project_id = @project_id 
        AND status != 'done' 
        AND due_date < CAST(GETUTCDATE() AS DATE)
    );
    DECLARE @open_conflicts INT = (SELECT COUNT(*) FROM conflict_records WHERE project_id = @project_id AND status = 'OPEN');
    DECLARE @open_annotations INT = (
      SELECT COUNT(*) FROM document_annotations da
      JOIN project_files pf ON da.document_id = pf.id
      WHERE pf.project_id = @project_id 
        AND da.status = 'OPEN'
        AND da.requires_resolution = 1
    );
    DECLARE @unread_messages INT = (
      SELECT COUNT(*) FROM project_messages pm
      JOIN project_members pmem ON pm.project_id = pmem.project_id
      WHERE pm.project_id = @project_id
        AND pmem.user_id = @user_id
        AND pm.sent_at > ISNULL(pmem.last_message_read, '1900-01-01')
    );
    DECLARE @days_remaining INT = DATEDIFF(DAY, CAST(GETUTCDATE() AS DATE), p.end_date);
    DECLARE @completed_milestones INT = (SELECT COUNT(*) FROM project_milestones WHERE project_id = @project_id AND is_completed = 1);
    DECLARE @total_milestones INT = (SELECT COUNT(*) FROM project_milestones WHERE project_id = @project_id);
    
    SELECT 
      @total_tasks as total_tasks,
      @completed_tasks as completed_tasks,
      @overdue_tasks as overdue_tasks,
      @open_conflicts as open_conflicts,
      @open_annotations as open_annotations,
      @unread_messages as unread_messages,
      @days_remaining as days_remaining,
      @completed_milestones as completed_milestones,
      @total_milestones as total_milestones,
      CASE 
        WHEN @total_tasks = 0 THEN 0
        ELSE CAST(@completed_tasks AS FLOAT) / @total_tasks * 100
      END as task_completion_percentage,
      CASE 
        WHEN @total_milestones = 0 THEN 0
        ELSE CAST(@completed_milestones AS FLOAT) / @total_milestones * 100
      END as milestone_completion_percentage,
      p.name as project_name,
      p.status as project_status
    FROM projects p
    WHERE p.id = @project_id
  `,

  // Get member activity summary
  getMemberActivitySummary: `
    SELECT 
      u.id,
      u.full_name,
      u.team,
      u.avatar_initials,
      CASE 
        WHEN u.last_login_at > DATEADD(HOUR, -2, GETUTCDATE()) THEN 'online'
        WHEN u.last_login_at > DATEADD(DAY, -1, GETUTCDATE()) THEN 'recent'
        ELSE 'offline'
      END as presence_status,
      (
        SELECT COUNT(*) 
        FROM audit_logs a 
        WHERE a.actor_id = u.id 
          AND a.created_at > DATEADD(DAY, -7, GETUTCDATE())
          AND (
            a.target_id IN (SELECT CAST(id AS NVARCHAR(100)) FROM projects WHERE id = @project_id)
            OR a.metadata LIKE '%project_id%' + CAST(@project_id AS NVARCHAR(36)) + '%'
          )
      ) as actions_this_week,
      (
        SELECT COUNT(*) 
        FROM tasks t 
        WHERE t.assigned_to = u.id 
          AND t.project_id = @project_id 
          AND t.status != 'done'
      ) as pending_tasks,
      pm.added_at as member_since
    FROM users u
    JOIN project_members pm ON u.id = pm.user_id
    WHERE pm.project_id = @project_id 
      AND pm.is_active = 1
    ORDER BY u.full_name
  `
};

module.exports = {
  workspaceActivityQueries,
  messageQueries,
  fileCollaborationQueries,
  workspaceAuditQueries,
  workspaceHealthQueries
};
