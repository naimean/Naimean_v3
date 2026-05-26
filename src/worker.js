    const aliasedPath = HTML_ROUTE_ALIASES.get(url.pathname);
    if (env.ASSETS) {
      if (aliasedPath) {
        return env.ASSETS.fetch(rewriteRequestPath(request, aliasedPath));
      }
      return env.ASSETS.fetch(request);
    }
    return fetch(request);
  },
};
