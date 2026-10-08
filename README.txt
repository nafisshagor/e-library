JCC E-Library — Jhenaidah Cadet College
========================================

Files
-----
index.html     App UI
styles.css     Theme & layout
app.js         Auth, catalog, PDF reader, admin
sw.js          Offline service worker (caches logo)
jcc-logo.png   College crest
schema.sql     Supabase tables, RLS, storage policies

Deploy (frontend)
-----------------
Upload these files to any static host (Netlify, Vercel, GitHub Pages,
or a simple web server). Keep them in the same folder.

Supabase (one-time)
-------------------
1. Auth → Providers → Email: turn OFF "Confirm email"
2. SQL Editor: run schema.sql in full (applies faculty role + storage policies)
3. Confirm bucket "books" exists (created by schema.sql, private)

Admin
-----
Sign in with an approved admin profile. Use Admin Control to:
- Approve / reject / restore / delete user profiles
- Upload PDF books (title, author, genre, max 50 MB)
- Delete books from the catalog

Note: Deleting a user removes their profile (library access). Full Auth
user removal still happens in the Supabase dashboard if needed.
