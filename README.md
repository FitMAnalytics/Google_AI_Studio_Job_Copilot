# Job Alignment Copilot

A React + Vite application that turns Gemini 2.5 into a copilot for tailoring resumes and crafting job application materials. Upload your resume (PDF, TXT, MD, or LaTeX), drop in a job description, and let the app parse, index, and reuse your experience to produce cover letters, tailored resumes, interview prep talking points, and more.

## Features
- **Resume parsing with Gemini 2.5 Flash** – extracts structured contact info, work experience, skills, and projects from uploaded resumes.
- **Local RAG knowledge base** – enriches and embeds resume content client-side so copilot responses stay grounded in your own experience.
- **Multi-action copilot** – generate cover letters, tailor resumes, rewrite bullets, prep for interviews, or chat with your career data.
- **Usage safeguards** – basic token tracking and error handling to surface API/key issues during long sessions.
- **Vite-powered DX** – fast dev server, TypeScript support, and static build output for easy hosting.

## Requirements
- Node.js 18+ (for Vite and the Google GenAI SDK)
- A Gemini API key with access to `gemini-2.5-flash`

## Setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env.local` file in the project root with your key (either variable name works because Vite maps `GEMINI_API_KEY`
   to `process.env.API_KEY` during the build):
   ```bash
   GEMINI_API_KEY=your_api_key_here
   # or
   API_KEY=your_api_key_here
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
   The app runs on [http://localhost:3000](http://localhost:3000) by default.

## Usage
1. Upload a resume file (PDF, TXT, MD, or TEX). The app parses it with Gemini and starts building a local vector index.
2. Paste the target job description and optionally the company/role names.
3. Pick a copilot action:
   - **Cover Letter** – draft a tailored cover letter.
   - **Tailor Resume** – generate a tailored resume variant.
   - **Rewrite Bullets** – refine selected experience bullets.
   - **Interview Prep** – brainstorm talking points.
   - **Ask Anything** – open-ended chat grounded in your resume.
4. Download outputs (Markdown and LaTeX exports are supported for tailored resumes) or continue iterating via chat.

## Scripts
- `npm run dev` – start the Vite dev server.
- `npm run build` – create an optimized production build in `dist/`.
- `npm run preview` – preview the production build locally.

## Deployment
The app builds to static assets, so you can host the `dist/` directory on any static site provider (Firebase Hosting, Netlify, Vercel, GitHub Pages, etc.).

1. Build the project:
   ```bash
   npm run build
   ```
2. Deploy the contents of `dist/` to your hosting provider of choice. Ensure the Gemini key (`GEMINI_API_KEY` or `API_KEY`) is provided at build time (for static hosts like Netlify/Vercel, add it as an environment variable before running `npm run build`) so the bundled app can access it.

## Project structure
```
.
├── App.tsx                # Main UI and copilot logic
├── components/            # UI building blocks (buttons, cards, chat, resume preview)
├── services/geminiService.ts # Gemini integration, parsing, embeddings, and RAG helpers
├── types.ts               # Shared TypeScript types and enums
├── vite.config.ts         # Vite configuration and env variable injection
└── index.tsx              # App entry point
```

## Troubleshooting
- If API requests fail, double-check that `GEMINI_API_KEY` is set before starting the dev server or building.
- The app tracks approximate token usage per session; reload the page to reset if you hit the session limit warning.

---
Built with ❤️ using Vite, React, and Gemini.
