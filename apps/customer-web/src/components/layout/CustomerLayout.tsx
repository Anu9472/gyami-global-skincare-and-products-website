import { Link, NavigationType, useLocation, useNavigationType, useOutlet } from 'react-router-dom';
import { Home, ShoppingBag, UserRound, BookOpen } from 'lucide-react';
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
      {location.pathname === '/' && <nav className="mobile-shop-nav" aria-label="Mobile shopping navigation"><Link className="is-current" to="/" aria-current="page"><Home /><span>Home</span></Link><Link to="/products"><ShoppingBag /><span>Shop</span></Link><a href="#our-story"><BookOpen /><span>Our story</span></a><Link to="/account"><UserRound /><span>Account</span></Link></nav>}
    </div>
  );
}
