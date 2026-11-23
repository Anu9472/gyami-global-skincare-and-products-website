import { ArrowRight, Check, Droplets, FlaskConical, Gem, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import brandBanner from '../assets/gyami/brand-banner.jpeg';
import logoImage from '../assets/gyami/gyami-logo-small.jpeg';
import { GyamiHero } from '../components/home/GyamiHero';
import { ScrollReveal } from '../components/home/ScrollReveal';

const products = [
  { id: 'vitamin-c-facewash', name: 'Vitamin C Facewash', family: 'Daily radiance ritual', image: '/media/gyami-vitamin-c-card.png', productImage: undefined, position: 'portrait', price: '₹199', mrp: '₹249' },
  { id: 'charcoal-facewash', name: 'Charcoal Facewash', family: 'Deep cleansing ritual', image: '/media/gyami-charcoal-card.png', productImage: undefined, position: 'portrait', price: '₹199', mrp: '₹249' },
  { id: 'haldi-chandan-facewash', name: 'Haldi Chandan Facewash', family: 'Ayurvedic-inspired ritual', image: '/media/gyami-haldi-card.png', productImage: undefined, position: 'portrait', price: '₹199', mrp: '₹249' },
  { id: 'gold-kesar-facewash', name: 'Gold Kesar Facewash', family: 'Saffron radiance ritual', image: '/media/gyami-gold-kesar-card.png', productImage: undefined, position: 'portrait', price: '₹199', mrp: '₹249' },
  { id: 'facewash-trio-combo', name: 'Facewash Trio Combo', family: 'Complete cleansing collection', image: '/media/gyami-facewash-trio-combo-premium.png', productImage: undefined, position: 'combo', price: '₹549', mrp: '₹747' },
  { id: 'detergent-liquid', name: 'Detergent Liquid', family: 'Premium home care', image: '/media/gyami-detergent-liquid-premium.png', productImage: undefined, position: 'detergent', price: '₹299', mrp: '₹399' },
] as const;

export function HomePage() {
  return (
    <>
      <GyamiHero />

      <div className="gyami-brand-ribbon" aria-label="GYAMI brand principles"><div><span>Modern cosmetic science</span><i /> <span>Refined aesthetics</span><i /> <span>Thoughtful beauty</span><i /> <span>Luxury in every touch</span><i /> <span aria-hidden="true">Modern cosmetic science</span><i aria-hidden="true" /> <span aria-hidden="true">Refined aesthetics</span></div></div>

      <ScrollReveal><section className="gyami-intro" aria-labelledby="gyami-intro-title">
        <div className="gyami-intro-glow" aria-hidden="true" />
        <div className="shell gyami-intro-grid">
          <div className="gyami-intro-index"><span>01</span><p>The house of GYAMI</p></div>
          <div className="gyami-intro-copy">
            <p className="gyami-intro-eyebrow">An Indian beauty house · A global point of view</p>
            <h2 id="gyami-intro-title">Beauty is more than appearance.<br />It is a <em>daily ritual.</em></h2>
            <div className="gyami-intro-rule" aria-hidden="true"><span /></div>
            <p>GYAMI® brings together modern cosmetic science, refined aesthetics, and the timeless art of personal care. Every detail is considered to make everyday care feel extraordinary.</p>
            <div className="gyami-intro-motto" aria-label="Luxury in every touch"><span>Luxury in</span><em>every touch</em></div>
            <div className="gyami-intro-values" aria-label="GYAMI values"><span>Modern science</span><i /><span>Refined aesthetics</span><i /><span>Timeless care</span></div>
          </div>
          <div className="gyami-intro-signature">
            <div className="gyami-intro-mark"><span aria-hidden="true" /><img src={logoImage} alt="GYAMI Global emblem" loading="lazy" decoding="async" /></div>
          </div>
        </div>
      </section></ScrollReveal>

      <ScrollReveal className="home-reveal--cards"><section className="gyami-collection" id="collection" aria-labelledby="collection-title"><div className="shell">
        <div className="gyami-section-heading"><div><p className="gyami-kicker">The opening collection</p><h2 id="collection-title">Nature-led rituals.<br />Care, refined.</h2></div><p>Vitamin C and orange, charcoal and neem, turmeric and sandalwood, plus the new Gold Kesar ritual—unified by the unmistakable GYAMI signature.</p></div>
        <div className="gyami-product-grid">{products.map((product) => <article className="gyami-product-card" key={product.id}><Link className="gyami-product-card__link" aria-label={`View ${product.name}`} to="/products"><div className={`gyami-product-image gyami-product-image--${product.position}`}><img className={product.productImage ? 'gyami-product-scene' : undefined} src={product.image} alt="" aria-hidden={product.productImage ? true : undefined} loading="lazy" decoding="async" />{product.productImage && <img className="gyami-product-cutout" src={product.productImage} alt={product.name} loading="lazy" decoding="async" />}{product.id === 'facewash-trio-combo' && <span className="gyami-combo-badge"><small>3 essentials</small><strong>Trio Combo</strong></span>}<span className="gyami-product-glow" aria-hidden="true" /></div><div className="gyami-product-info"><div><p>{product.family}</p><h3>{product.name}</h3><div className="gyami-product-price"><strong>{product.price}</strong>{product.mrp && <del>{product.mrp}</del>} {product.mrp && <span>Launch offer</span>}</div></div><span className="gyami-card-cta">Explore</span></div></Link></article>)}</div>
        <div className="gyami-collection-action"><Link className="button gyami-button--purple" to="/products">View all products <ArrowRight size={17} /></Link></div>
      </div></section></ScrollReveal>

      <ScrollReveal><section className="gyami-philosophy" id="our-philosophy" aria-labelledby="philosophy-title"><div className="shell gyami-philosophy-grid"><div className="gyami-philosophy-image"><img src={brandBanner} alt="GYAMI Global brand identity and promise: Luxury in Every Touch" loading="lazy" decoding="async" /></div><div className="gyami-philosophy-copy"><p className="gyami-kicker">Our philosophy</p><h2 id="philosophy-title">Thoughtful beauty.<br />Refined experience.</h2><p>Premium beauty should combine modern cosmetic science with thoughtful formulation and exceptional presentation. We communicate with clarity—without exaggerated promises.</p><ul><li><Check /> Carefully selected cosmetic ingredients</li><li><Check /> Thoughtfully developed formulations</li><li><Check /> Premium packaging and presentation</li><li><Check /> Responsible, transparent communication</li></ul><a className="gyami-text-link" href="#our-story">Discover our story <ArrowRight size={16} /></a></div></div></section></ScrollReveal>

      <ScrollReveal><section className="gyami-pillars" aria-label="GYAMI principles"><div className="shell gyami-pillar-grid"><article><FlaskConical /><span>01</span><h3>Modern science</h3><p>Purposeful products designed around contemporary routines.</p></article><article><Gem /><span>02</span><h3>Refined design</h3><p>Distinctive purple and champagne-gold presentation.</p></article><article><ShieldCheck /><span>03</span><h3>Responsible beauty</h3><p>Clear communication and a commitment to continuous improvement.</p></article><article><Droplets /><span>04</span><h3>Daily ritual</h3><p>Elevating familiar moments of everyday personal care.</p></article></div></section></ScrollReveal>

      <ScrollReveal><section className="gyami-story" id="our-story" aria-labelledby="story-title"><div className="shell gyami-story-grid"><div><p className="gyami-kicker">Indian origin · Global vision</p><h2 id="story-title">A modern Indian beauty house with a world of ambition.</h2></div><div><p>Born in India, GYAMI GLOBAL PRIVATE LIMITED is building a growing portfolio across premium skincare, personal care, haircare, and lifestyle beauty.</p><p>Our journey begins with skincare and continues toward a broader vision of modern luxury beauty—modern, refined, confident, and timeless.</p><Link className="button gyami-button--gold" to="/products">Begin your ritual <Sparkles size={17} /></Link></div></div></section></ScrollReveal>
    </>
  );
}
