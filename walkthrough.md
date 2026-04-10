# CADS-Bridge Deployment Guide 🚀

I've updated your codebase to integrate **Cloudinary** so your files are securely hosted and never deleted on server restarts. Here is exactly how to deploy your MS SQL Database, Node.js Backend, and React Frontend for free.

> [!WARNING]
> Before you begin, you **must run** `cd server && npm install` in your terminal to install the new `cloudinary` dependencies I've added to your package.json!

---

## 1. File Storage: Cloudinary (Free)
Since your Render backend will be ephemeral, we need to host your project files securely in the cloud.

1. Go to [Cloudinary](https://cloudinary.com) and sign up for a free account.
2. Go to your **Dashboard**.
3. Note your **Cloud Name**, **API Key**, and **API Secret**. You will need these for your local `.env` and Render's environment variables.

---

## 2. Database: Azure SQL (Free)
This step will host your MS SQL database gracefully for free.

1. Go to the [Azure Portal](https://portal.azure.com/) and create a free account.
2. Search for **Azure SQL** in the top bar.
3. Click **Create**, then select **SQL Databases** (Single Database). 
4. **Crucial setup**:
   - In the "Compute + storage" section, carefully select the **Free Tier** (100,000 vCore Seconds / 32GB Data).
   - Create a clever Admin username and Admin password. Keep these extremely safe.
   - Go to networking settings and make sure to **"Allow Azure services and resources to access this server"** (so Render can connect to it) and add your local IP so you can connect locally!
5. After it deploys, look at your **Server name** (e.g., `cads-server.database.windows.net`).

> [!IMPORTANT]
> Update your `server/.env` with your new Azure credentials:
> ```env
> DB_SERVER=cads-server.database.windows.net
> DB_USER=your_admin_username
> DB_PASSWORD=your_admin_password
> DB_NAME=your_database_name
> DB_ENCRYPT=false
> DB_TRUST_SERVER_CERT=true
> CLOUDINARY_CLOUD_NAME=your_name
> CLOUDINARY_API_KEY=your_key
> CLOUDINARY_API_SECRET=your_secret
> ```
> Then run `npm run migrate` inside your local `server/` directory. This will push all your tables to the live Azure Server!

---

## 3. Backend: Render (Free)
This handles your WebSockets (Socket.IO) and API.

1. Upload/Push your code to a **GitHub Repository**.
2. Go to [Render](https://render.com) and log in.
3. Create a new **Web Service**, and select your GitHub repository.
4. **Configuration Settings**:
   - **Root Directory**: `server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. **Environment Variables**: Add everything from your `server/.env` file. Do not forget `JWT_SECRET`, `CLIENT_URL` (which will be your Vercel URL later), your new Cloudinary keys, and your Azure SQL database credentials.
6. Click **Deploy**. Note the live URL Render gives you (e.g. `https://cads-bridge-api.onrender.com`).

---

## 4. Frontend: Vercel (Free)
Host your React CRA securely.

1. Go to [Vercel](https://vercel.com) and log in with GitHub.
2. Click **Add New -> Project** and select your `cads-bridge` repository.
3. **Configuration Settings**:
   - **Root Directory**: `client`
   - **Framework Preset**: Create React App.
   - **Build Command**: `npm run build`
4. **Environment Variables**:
   - Vercel needs to know to hit your Render backend! Add a variable named something like `REACT_APP_API_URL` (or whatever your client uses currently to connect to the backend URL) and set it to your new Render Backend URL (e.g. `https://cads-bridge-...onrender.com`).
5. Click **Deploy**!

> [!TIP]
> After Vercel deploys, remember to go back to **Render** and make sure the `CLIENT_URL` environment variable is set precisely to your new Vercel URL exactly (e.g. `https://cads-v1.vercel.app`), so that CORS won't block the frontend from calling the backend. 

### Final Verification 
- [x] Run `cd server && npm install` to gather the Cloudinary package!
- [x] Check Azure portal is active.
- [x] Run backend migrations locally to initialize the tables on Azure.
- [x] Test your Vercel URL on mobile and desktop!
