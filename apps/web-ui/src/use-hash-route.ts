import { useEffect, useState } from 'react';

const DEFAULT_ROUTE = '/overview';

function currentRoute(): string {
  const route = window.location.hash.slice(1);
  return route.startsWith('/') ? route : DEFAULT_ROUTE;
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const update = (): void => {
      setRoute(currentRoute());
    };
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('hashchange', update);
    };
  }, []);

  return route;
}
