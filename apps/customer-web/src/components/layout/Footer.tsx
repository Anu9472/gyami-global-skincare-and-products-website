import { Instagram, Mail, MapPin, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import logoImage from '../../assets/gyami/gyami-logo-small.jpeg';

export function Footer() {
  return <footer className="site-footer gyami-footer"><div className="shell gyami-footer-top"><div className="gyami-footer-brand"><Link className="gyami-brand" to="/"><img src={logoImage} alt="" /><span><strong>GYAMI GLOBAL</strong><small>Private Limited</small></span></Link><p>Premium skincare and beauty.<br />Luxury in every touch.</p></div><div><h2>Explore</h2><Link to="/products">Our collection</Link><a href="/#our-story">Our story</a><a href="/#our-philosophy">Our philosophy</a></div><div><h2>Customer care</h2><Link to="/account">My account</Link><Link to="/orders">My orders</Link><Link to="/complaints">Support</Link><Link to="/notifications">Notifications</Link></div><div><h2>Connect</h2><a href="mailto:gyamiglobal@gmail.com"><Mail /> gyamiglobal@gmail.com</a><a href="tel:+918806611432"><Phone /> +91 88066 11432</a><span><MapPin /> Buldhana, Maharashtra, India</span><a href="https://instagram.com/gyamiglobal" target="_blank" rel="noreferrer"><Instagram /> @gyamiglobal</a></div></div><div className="shell footer-bottom"><span>© {new Date().getFullYear()} GYAMI GLOBAL PRIVATE LIMITED</span><span>Beauty · Care · You</span></div></footer>;
}
