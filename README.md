---
title: Control de Personal y Expendios CAMARCA 4-72
emoji: 📦
colorFrom: yellow
colorTo: blue
sdk: docker
app_port: 7860
pinned: false
---

# Sistema de Control de Personal y Expendios — CAMARCA S.A.S. | 4-72

Aplicación web full-stack (React + Vite + Node.js/Express) con persistencia segura en la nube (AWS S3).

## Variables Secretas Requeridas (Space Settings → Variables and secrets)
- `ADMIN_ACCESS_PASSWORD`
- `ADMIN_MASTER_PASSWORD`
- `JWT_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION` (`us-east-1`)
- `AWS_S3_BUCKET` (`camarca-expendios-photos-contingency`)
- `S3_BUCKET` (`camarca-expendios-photos-contingency`)
- `GEMINI_API_KEY` *(opcional, solo para funciones con IA)*
