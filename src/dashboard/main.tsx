// main.tsx — the dashboard's entry (BATON-UI-V2, B-193): mounts the shell into the page's one
// root. `npm run build:ui` builds this module — with the stylesheet it imports — into the one
// bundle both hosts serve as text at `/dashboard/app.js` (R-BTN-55); nothing is fetched from
// another origin (§12.3).
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/app.css';

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
