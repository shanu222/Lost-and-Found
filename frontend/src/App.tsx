// Routing with session-aware guards:
//   signed out            → /signin
//   signed in, not set up → /onboarding
//   signed in, set up     → app (home, settings)
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Header, TabBar } from './components/Header';
import { LoadingState } from './components/ui';
import Home from './pages/Home';
import SignIn from './pages/SignIn';

const Onboarding = lazy(() => import('./pages/Onboarding'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

function Shell({ children, tabs = true }: { children: React.ReactNode; tabs?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <Header />
      <Suspense fallback={<LoadingState />}>{children}</Suspense>
      {tabs && <TabBar />}
    </div>
  );
}

function AppRoutes() {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return (
      <div className="full-center">
        <LoadingState />
      </div>
    );
  }

  if (status === 'signedOut') {
    return (
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }

  if (!user?.onboarding.completed) {
    return (
      <Routes>
        <Route
          path="/onboarding"
          element={
            <Shell tabs={false}>
              <Onboarding />
            </Shell>
          }
        />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/signin" element={<Navigate to="/" replace />} />
      <Route path="/onboarding" element={<Navigate to="/" replace />} />
      <Route
        path="/"
        element={
          <Shell>
            <Home />
          </Shell>
        }
      />
      <Route
        path="/settings"
        element={
          <Shell>
            <Settings />
          </Shell>
        }
      />
      <Route
        path="*"
        element={
          <Shell>
            <NotFound />
          </Shell>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
