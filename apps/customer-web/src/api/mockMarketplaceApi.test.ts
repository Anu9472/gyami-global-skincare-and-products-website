import { beforeEach, describe, expect, it } from 'vitest';
import { createMockMarketplaceApi } from './mockMarketplaceApi';

describe('GYAMI Global development storefront adapter', () => {
  beforeEach(() => window.localStorage.clear());

  it('exposes the complete six-product opening collection', async () => {
    const api = createMockMarketplaceApi();
    const result = await api.getProducts({ page: 1, limit: 20 });
    expect(result.meta.total).toBe(6);
    expect(result.items.map((product) => product.name)).toEqual(expect.arrayContaining([
      'Vitamin C Facewash',
      'Charcoal Facewash',
      'Haldi Chandan Facewash',
      'Gold Kesar Facewash',
      'GYAMI Facewash Trio Combo',
      'Detergent Liquid',
    ]));
  });

  it('uses only the official skincare and home-care categories', async () => {
    const api = createMockMarketplaceApi();
    const categories = await api.getCategories();
    expect(categories.map((category) => category.name)).toEqual(['Skincare', 'Home Care']);
  });

  it('finds products through collection search', async () => {
    const api = createMockMarketplaceApi();
    const result = await api.getProducts({ search: 'charcoal', page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.slug).toBe('charcoal-facewash');
  });

  it('identifies GYAMI Global as the official product owner', async () => {
    const api = createMockMarketplaceApi();
    const product = await api.getProduct('prod-detergent-liquid');
    expect(product.vendor.name).toBe('GYAMI Global Private Limited');
    expect(product.vendor.productCount).toBe(6);
  });

  it('adds an available launch facewash to the cart', async () => {
    const api = createMockMarketplaceApi();
    const cart = await api.addCartItem('prod-vitamin-c-facewash', 1);
    expect(cart.itemCount).toBe(1);
    expect(cart.groups[0]?.items[0]?.currentUnitPrice.amount).toBe(199);
  });

  it('starts the migrated customer account without legacy order history', async () => {
    const api = createMockMarketplaceApi();
    const orders = await api.getOrders({ page: 1, limit: 10 });
    expect(orders.items).toEqual([]);
  });
});
