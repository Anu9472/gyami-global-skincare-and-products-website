import { Bell, LogOut, Menu, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import logoImage from '../../assets/gyami/gyami-logo-small.jpeg';
import { useAuth } from '../../auth/AuthProvider';
import { useCart } from '../../features/cart/hooks';

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';
  const { session, logout } = useAuth();
  const cart = useCart(Boolean(session));

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    void navigate(query ? `/products?search=${encodeURIComponent(query)}` : '/products');
    setMenuOpen(false);
  };

  return <>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <header className={`site-header ${isHome ? 'site-header--home' : ''}`}>
      <div className="announcement">Premium skincare &amp; beauty · Luxury in every touch</div>
      <div className="shell header-main">
        <button className="icon-button mobile-menu" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? <X /> : <Menu />}</button>
        <Link className="brand gyami-brand" to="/" aria-label="GYAMI Global home"><img src={logoImage} alt="" width="320" height="320" decoding="async" /><span><strong>GYAMI GLOBAL</strong><small>Private Limited</small></span></Link>
        <form className="header-search" role="search" onSubmit={submitSearch}><Search size={19} aria-hidden="true" /><label className="sr-only" htmlFor="site-search">Search the GYAMI collection</label><input id="site-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isHome ? 'Search' : 'Search the collection…'} /></form>
        <nav className={`header-actions ${menuOpen ? 'is-open' : ''}`} aria-label="Customer navigation">
          <NavLink to="/products" onClick={() => setMenuOpen(false)}>Collection</NavLink>
          {isHome && <><a href="#our-story" onClick={() => setMenuOpen(false)}>Our story</a><a href="#our-philosophy" onClick={() => setMenuOpen(false)}>Philosophy</a></>}
          {session ? <div className="account-menu"><NavLink to="/account" onClick={() => setMenuOpen(false)}><UserRound size={19} /> <span>{session.customer.name.split(' ')[0]}</span></NavLink><NavLink to="/notifications" aria-label="Notifications" onClick={() => setMenuOpen(false)}><Bell size={18} /></NavLink><button type="button" aria-label="Log out" onClick={() => void logout()}><LogOut size={17} /></button></div> : <NavLink to="/login" onClick={() => setMenuOpen(false)}><UserRound size={19} /> Account</NavLink>}
          <NavLink className="cart-action" to="/cart" onClick={() => setMenuOpen(false)}><ShoppingBag size={20} /> Cart <span>{session ? (cart.data?.itemCount ?? 0) : 0}</span></NavLink>
        </nav>
      </div>
      {!isHome && <div className="category-nav-wrap"><nav className="shell category-nav" aria-label="Main navigation"><NavLink to="/products" end>All products</NavLink><NavLink to="/products?category=cat-skincare">Skincare</NavLink><NavLink to="/products?category=cat-home-care">Home care</NavLink><a href="/#our-story">Our story</a><a href="/#our-philosophy">Philosophy</a></nav></div>}
    </header>
  </>;
}
