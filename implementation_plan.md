# Hosting & Deployment Plan (Updated)

Based on your feedback, we are **canceling** the PostgreSQL migration to save time and effort. We will keep your Microsoft SQL Server setup. We will also solve the file upload wiping issue by switching out the local `diskStorage` for **Cloudinary**, a cloud storage provider with a generous **25GB forever-free tier**, ensuring your server won't delete user uploads upon restart.

Here is the updated architecture for deploying your full-stack app completely for **FREE**:

## 1. The Deployment Stack
*   **Database: Azure SQL Database (Free Tier)**
    *   **Why:** Azure provides an incredible 100,000 vCore seconds and 32GB of SQL Server data per month completely free for the life of the subscription. This means we do not need to change a single SQL query in your codebase.
*   **Backend: Render Web Services (Free Tier)**
    *   **Why:** Perfect for hosting Node/Express and Socket.io applications. Provides a free, always-on (with auto-sleep) HTTPS service.
*   **Frontend: Vercel (Free Tier)**
    *   **Why:** The undisputed best free host for React. Automatic deployments via GitHub.
*   **File Storage: Cloudinary (Free Tier)**
    *   **Why:** 25GB free tier forever. On PaaS providers like Render, the local file system is "ephemeral" (it gets wiped whenever the server restarts). Moving storage to the Cloud guarantees user uploads persist.

## 2. Proposed Code Changes (Storage Fix)

To make file uploads persist without breaking **any** frontend functions or existing downloads, we will gracefully integrate cloud storage. 

#### [MODIFY] `server/package.json`
- Add `cloudinary`, `multer-storage-cloudinary` to the backend.

#### [MODIFY] `server/src/middleware/upload.js`
- Change `multer.diskStorage` to `CloudinaryStorage`.
- Ensure it handles all existing `ALLOWED_TYPES` flawlessly (using Cloudinary's `raw` resource configuration so it isn't only limited to images).

#### [MODIFY] `server/src/routes/workspace.js`
- When a file is uploaded, save the `secure_url` given by Cloudinary into your MS SQL database under the `file_path` column.
- Update the **Download Route** (`/files/:fileId/download`). Instead of `res.sendFile(localPath)`, we will do `res.redirect(file.file_path)`. This ensures that whenever a user clicks "Download" on the frontend, it successfully initiates the file download from the cloud URL without needing frontend code changes.

## User Review Required

> [!IMPORTANT]
> This plan completely drops the PostgreSQL rewrite, utilizes Azure's free MS SQL server, and seamlessly fixes the file deletion bug on Render by plugging in Cloudinary. This ensures maximum uptime entirely for free.
> 
> **Are you ready to approve this plan so I can implement the Cloudinary code changes and provide the final step-by-step setup walkthrough for Render, Azure, and Vercel?**
