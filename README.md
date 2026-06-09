# CV Hub App

A simple local web app to manage multiple HTML/CSS resumes, preview them, upload a shared profile picture, and export the selected resume as a PDF.

## Features

- Create and save multiple resumes
- Store each resume in its own folder
- Edit HTML and CSS separately
- Upload one shared `pp.png` profile picture
- Preview resumes in an isolated iframe
- Export the currently selected resume as a PDF

## Project Structure

```text
cv-hub-app/
├── data/
│   └── cvs/
│       └── example-cv/
│           ├── index.html
│           ├── styles.css
│           └── metadata.json
├── public/
│   ├── index.html
│   ├── app.css
│   └── app.js
├── uploads/
│   └── pp.png
├── server.js
├── package.json
└── README.md
```

## Installation

Choose the command depending on your environment.

### Windows / macOS

```bash
npm run setup
```

### Linux / VPS

Use this version on Linux because Playwright/Chromium needs additional system dependencies for PDF export.

```bash
npm run setup:linux
```

## Start

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

On a VPS, use:

```text
http://YOUR_SERVER_IP:3000
```

## Resume Storage

Each resume is stored in its own folder:

```text
data/cvs/my-resume/
├── index.html
├── styles.css
└── metadata.json
```

This makes every resume easy to edit manually or with an LLM.

## Shared Profile Picture

All resumes use the same shared image:

```text
uploads/pp.png
```

In the resume HTML, reference it like this:

```html
<img src="pp.png" alt="Profile picture">
```

## PDF Export

PDF export is powered by Playwright.

If PDF export returns an error on Linux or VPS, run:

```bash
npm run setup:linux
```

If permissions were broken after copying files between machines, reset the install:

```bash
rm -rf node_modules package-lock.json
npm install
npm run setup:linux
```