import { BadgeCheck, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { Product } from '../../api/types';
import { ApiError, getErrorMessage } from '../../api/errors';
import { useAuth } from '../../auth/AuthProvider';
import { useAddToCart } from '../../features/cart/hooks';
import { discountPercentage, formatMoney } from '../ui/format';

export function ProductCard({ product }: { product: Product }) {
  const addToCart = useAddToCart();
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState('');
  const discount = discountPercentage(product.price, product.mrp);
  const outOfStock = product.stockStatus === 'OUT_OF_STOCK';
  const comingSoon = product.price.amount === 0;

  const add = async () => {
    const returnTo = `${location.pathname}${location.search}`;
    if (!isAuthenticated) {
      navigate('/login', { state: { from: returnTo } });
      return;
    }
    try {
      await addToCart.mutateAsync({ productId: product.id, quantity: 1 });
      setNotice(`${product.name} added to cart.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate('/login', { state: { from: returnTo, notice: 'Please sign in to add products to your cart.' } });
        return;
      }
      setNotice(getErrorMessage(error));
    }
  };

  return (
    <article className="product-card">
      <Link className={`product-card-image product-card-image--${product.slug}`} to={`/products/${product.id}`}>
        {product.images[0] ? <img src={product.images[0]} alt={product.name} width="640" height="480" loading="lazy" decoding="async" /> : <span className="product-image-empty" aria-label="No product image available">No image</span>}
        {discount !== null && <span className="discount-badge">{discount}% off</span>}
        {product.verified && <span className="product-verification-badge" aria-label="Official GYAMI Global product"><BadgeCheck aria-hidden="true" /><span><small>Official product</small><strong>GYAMI Global</strong></span></span>}
        {outOfStock && <span className="stock-overlay">Launching soon</span>}
      </Link>
      <div className="product-card-body">
        {product.reviewCount > 0 ? <div className="rating"><Star size={14} fill="currentColor" aria-hidden="true" /><span>{product.rating}</span><span className="muted">({product.reviewCount})</span></div> : <div className="rating rating--new">Opening collection</div>}
        <Link to={`/products/${product.id}`}><h3>{product.name}</h3></Link>
        <p className="product-meta">{product.weight} · GST inclusive</p>
        <div className="product-card-purchase">
          <div className="product-price">{comingSoon ? <strong className="launch-price">Price to be announced</strong> : <><strong>{formatMoney(product.price)}</strong>{product.mrp && <del>{formatMoney(product.mrp)}</del>}<small>GST incl.</small></>}</div>
          <button
            className="add-button"
            type="button"
            disabled={outOfStock || addToCart.isPending}
            aria-label={addToCart.isPending ? `Adding ${product.name} to cart` : outOfStock ? `${product.name} is unavailable` : `Add ${product.name} to cart`}
            title={outOfStock ? 'Launching soon' : 'Add to cart'}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void add();
            }}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
        {notice && <p className={addToCart.isError ? 'product-notice form-error' : 'product-notice'} role="status" aria-live="polite">{notice}</p>}
      </div>
    </article>
  );
}
