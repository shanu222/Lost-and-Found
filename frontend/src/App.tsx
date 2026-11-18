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
const Browse = lazy(() => import('./pages/Browse'));
const ItemPage = lazy(() => import('./pages/ItemPage'));
const FoundWizard = lazy(() => import('./pages/FoundWizard'));
const LostWizard = lazy(() => import('./pages/LostWizard'));
const MyItems = lazy(() => import('./pages/MyItems'));
const ClaimForm = lazy(() => import('./pages/Claims').then((m) => ({ default: m.ClaimForm })));
const ClaimReview = lazy(() => import('./pages/Claims').then((m) => ({ default: m.ClaimReview })));
const ClaimDetail = lazy(() => import('./pages/Claims').then((m) => ({ default: m.ClaimDetail })));
const MessagesList = lazy(() => import('./pages/Messages').then((m) => ({ default: m.MessagesList })));
const Chat = lazy(() => import('./pages/Messages').then((m) => ({ default: m.Chat })));
const Handover = lazy(() => import('./pages/Handover'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Admin = lazy(() => import('./pages/Admin'));

const APP_ROUTES: [string, React.ComponentType][] = [
  ['/browse', Browse],
  ['/items/:id', ItemPage],
  ['/items/:id/claim', ClaimForm],
  ['/found/new', FoundWizard],
  ['/lost/new', LostWizard],
  ['/my', MyItems],
  ['/my/:tab', MyItems],
  ['/my/found/:id/claims', ClaimReview],
  ['/claims/:id', ClaimDetail],
  ['/claims/:id/handover', Handover],
  ['/messages', MessagesList],
  ['/messages/:id', Chat],
  ['/notifications', Notifications],
  ['/settings', Settings],
];

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
      {APP_ROUTES.map(([path, Page]) => (
        <Route
          key={path}
          path={path}
          element={
            <Shell>
              <Page />
            </Shell>
          }
        />
      ))}
      {(user.role === 'admin' || user.role === 'moderator') && (
        <>
          <Route path="/admin" element={<Shell><Admin /></Shell>} />
          <Route path="/admin/:tab" element={<Shell><Admin /></Shell>} />
        </>
      )}
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
