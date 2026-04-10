# CADS-Bridge Deployment Guide 🚀

I've configured your project to run entirely on **Vercel** for free (both Frontend and Backend), bypassing the need for Render or Zeabur, and skipping credit card requirements. Your file uploads persist thanks to Cloudinary, and your database runs on Azure SQL.

> [!WARNING]
> Because Vercel uses "Serverless Functions" instead of a long-running server, it does not support continuous WebSocket connections. We have modified the configurations so your app gracefully handles this constraint. Everything works (CRUD, DB, APIs, File Uploads) but real-time connection features like Socket.IO will be limited to local development.

---

## 1. File Storage: Cloudinary (Free)
Since Vercel has read-only filesystems, we use Cloudinary to store your user-uploaded files safely.

1. Ensure you have your **Cloud Name**, **API Key**, and **API Secret** ready.
2. The codebase has already been updated to securely push all uploads to Cloudinary and download from it.

---

## 2. Database: Azure SQL (Free)
Your database is hosted gracefully on Azure.

1. Ensure your local `server/.env` is set correctly:
```env
DB_SERVER=cads-brdge-db-final.database.windows.net
DB_USER=your_admin_username
DB_PASSWORD=your_admin_password
DB_NAME=cads-bridge-db-final
DB_ENCRYPT=true
DB_TRUST_SERVER_CERT=true
```
2. You've already run the backend migrations on Azure.

---

## 3. Backend Deployment: Vercel Serverless (Free)

We use Vercel Serverless Functions to host the Express backend completely for free, right alongside your frontend.

1. Go to [Vercel](https://vercel.com) and log in.
2. Click **Add New -> Project** and select your `cads-bridge` GitHub repository.
3. **Crucial Configuration Settings**:
   - **Project Name**: `cads-bridge-backend`
   - **Framework Preset**: `Other`
   - **Root Directory**: `server`
   - **Build Command**: Leave empty or set to default (Override and leave blank)
4. **Environment Variables**: Add everything from your `server/.env` file. You also MUST set:
   - `VERCEL = 1` (This tells our code to avoid trying to setup WebSockets and disables the file logger)
   - Do not forget `JWT_SECRET`, `CLIENT_URL` (this will be your frontend Vercel URL), your Cloudinary keys, and your Azure SQL credentials.
5. Click **Deploy**. Note the live URL Vercel gives you (e.g. `https://cads-bridge-backend.vercel.app`).

> [!TIP]
> Go to Vercel Settings -> Functions, and set "Function Region" to Washington D.C or a region closer to your Azure SQL database to reduce latency.

---

## 4. Frontend Deployment: Vercel React (Free)
Deploy your frontend React app as a _separate_ project on Vercel.

1. Go back to Vercel dashboard and click **Add New -> Project** again. Select the same `cads-bridge` repository.
2. **Crucial Configuration Settings**:
   - **Project Name**: `cads-bridge-client`
   - **Framework Preset**: `Create React App`
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
3. **Environment Variables**:
   - `REACT_APP_API_URL = https://cads-bridge-backend.vercel.app` (Change this to whatever your backend Vercel URL is, **with NO trailing slash**)
4. Click **Deploy**. Note your new live client URL (e.g., `https://cads-bridge-client.vercel.app`).

> [!TIP]
> After deploying the Frontend, remember to go back to your **Backend Vercel Project** and update the `CLIENT_URL` environment variable to match your new client URL precisely. This is crucial for CORS! 

---

### Verification
If everything is done correctly:
- Your API serverless endpoints work.
- Visiting your React site fetches data correctly and logs users in. 
- You do not need any credit card.
