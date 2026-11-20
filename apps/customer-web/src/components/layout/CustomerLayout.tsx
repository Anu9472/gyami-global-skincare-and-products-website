import { NavigationType, useLocation, useNavigationType, useOutlet } from 'react-router-dom';
import { runtimeConfig } from '../../api';
import { Footer } from './Footer';
import { Header } from './Header';
import { PageTransition } from './PageTransition';

export function CustomerLayout() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const outlet = useOutlet();
  const isLoginScreen = location.pathname === '/login';

  return (
    <div className={isLoginScreen ? 'app-shell app-shell--login' : 'app-shell'}>
      {runtimeConfig.isMock && <div className="development-banner" role="status">Development adapter active — catalogue, account and checkout data are local mock responses.</div>}
      <Header />
      <main id="main-content"><PageTransition transitionKey={`${location.pathname}${location.search}`} direction={navigationType === NavigationType.Pop ? 'back' : 'forward'}>{outlet}</PageTransition></main>
      {!isLoginScreen && <Footer />}
    </div>
  );
}
