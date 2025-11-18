## Hijab compliance web app

This project provides a Vercel-ready UI that uploads photos, proxies them to the Python facial-processing service, polls for completion, and displays the original or blurred result depending on the hijab prediction.

## Requirements

- Node.js 18+
- Existing Python backend (see `hijab.py`) reachable over HTTP with the `/process_image` and `/get_result/<task_id>` routes.

## Local setup

1. Duplicate the example environment file and adjust it to point at your Python service:

   ```bash
   cp env.example .env.local
   # opens the file so you can replace the URL if needed
   ```

   ```
   HIJAB_BACKEND_URL=http://localhost:5000
   ```

2. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) and upload a photo. The UI will:
   - send the photo to `/api/analyze`, which forwards it to the Python backend
   - poll `/api/result/:taskId` until the backend returns either JSON (error) or the processed image

## Deployment

1. In Vercel, set the same `HIJAB_BACKEND_URL` environment variable (Production & Preview).
2. Deploy the app (either via Git or `vercel deploy`).
3. Ensure the Python service exposes HTTPS and allows requests from your Vercel domain.

That’s it—no additional storage or databases are required. Your Render-hosted hijab model continues to do the classification while Vercel handles the UI + proxy.
