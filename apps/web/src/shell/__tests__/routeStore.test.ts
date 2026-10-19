import { describe, it, expect, beforeEach } from 'vitest';
import { parseHash, toHash, useRouteStore } from '../routeStore.js';

describe('parseHash', () => {
  it('reads the map from an empty hash, `#` and `#/`', () => {
    for (const hash of ['', '#', '#/']) {
      expect(parseHash(hash)).toEqual({ name: 'map', sub: null, params: {} });
    }
  });

  it('reads every destination, its sub-route and its query', () => {
    expect(parseHash('#/timeline')).toEqual({ name: 'timeline', sub: null, params: {} });
    expect(parseHash('#/insights/reflections')).toEqual({ name: 'insights', sub: 'reflections', params: {} });
    expect(parseHash('#/review/duplicates')).toEqual({ name: 'review', sub: 'duplicates', params: {} });
    expect(parseHash('#/recall?q=sync%20key')).toEqual({ name: 'recall', sub: null, params: { q: 'sync key' } });
    expect(parseHash('#/welcome').name).toBe('welcome');
    expect(parseHash('#/settings').name).toBe('settings');
    // The plates are gone; an old link to them lands on the map.
    expect(parseHash('#/plates').name).toBe('map');
  });

  it('opens a memory over any route with ?m=', () => {
    expect(parseHash('#/?m=abc')).toEqual({ name: 'map', sub: null, params: { m: 'abc' } });
    expect(parseHash('#/timeline?m=abc').params.m).toBe('abc');
  });

  it('lands an unknown path on the map instead of a blank screen', () => {
    expect(parseHash('#/nowhere/at/all').name).toBe('map');
    expect(parseHash('#/nowhere').sub).toBeNull();
  });
});

describe('toHash', () => {
  it('is the inverse of parseHash', () => {
    for (const hash of ['#/', '#/timeline', '#/insights/reflections', '#/recall?q=sync+key', '#/review?m=abc']) {
      expect(toHash(parseHash(hash))).toBe(hash);
    }
  });
});

describe('useRouteStore', () => {
  beforeEach(() => {
    window.location.hash = '';
    useRouteStore.setState({ route: parseHash('') });
  });

  it('navigates by writing the hash, so Back returns', () => {
    useRouteStore.getState().navigate('/timeline');
    expect(window.location.hash).toBe('#/timeline');
    expect(useRouteStore.getState().route.name).toBe('timeline');

    useRouteStore.getState().navigate('#/insights/reflections');
    expect(useRouteStore.getState().route).toEqual({ name: 'insights', sub: 'reflections', params: {} });
  });

  it('follows the hash when it changes from outside (Back, a typed URL, a link)', () => {
    window.location.hash = '#/review';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(useRouteStore.getState().route.name).toBe('review');
  });

  it('sets and clears one parameter in place, keeping the route and the others', () => {
    useRouteStore.getState().navigate('/recall?q=sync');
    useRouteStore.getState().setParam('m', 'abc');
    expect(window.location.hash).toBe('#/recall?q=sync&m=abc');
    expect(useRouteStore.getState().route).toEqual({ name: 'recall', sub: null, params: { q: 'sync', m: 'abc' } });

    useRouteStore.getState().setParam('m', null);
    expect(window.location.hash).toBe('#/recall?q=sync');
    expect(useRouteStore.getState().route.params).toEqual({ q: 'sync' });
  });

  it('does not add a history entry for a parameter', () => {
    useRouteStore.getState().navigate('/timeline');
    const before = window.history.length;
    useRouteStore.getState().setParam('m', 'abc');
    expect(window.history.length).toBe(before);
  });
});
