import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fonts (no third-party requests; CSP-friendly). Each package uses
// unicode-range subsets, so browsers only download the scripts they render.
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/600.css';
import '@fontsource/noto-sans-arabic/400.css';
import '@fontsource/noto-sans-arabic/600.css';
import '@fontsource/noto-sans-arabic/700.css';
import '@fontsource/noto-nastaliq-urdu/400.css';
import '@fontsource/noto-nastaliq-urdu/700.css';
import './styles/index.css';
import { initI18n } from './i18n';
import App from './App';

// Load the user's chosen language before the first render (no flash of English
// for Urdu/Arabic users who already picked their language).
void initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
