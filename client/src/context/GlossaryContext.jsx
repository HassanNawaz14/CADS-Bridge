import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { knowledgeHubAPI } from '../services/api';

const GlossaryContext = createContext(null);

export const GlossaryProvider = ({ children }) => {
  const [terms, setTerms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        const res = await knowledgeHubAPI.glossarySearch({ status: 'PUBLISHED' });
        if (!mounted) return;
        setTerms(res.data.terms || []);
      } catch {
        if (!mounted) return;
        setTerms([]);
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(() => ({ terms, loading, refresh: async () => {
    const res = await knowledgeHubAPI.glossarySearch({ status: 'PUBLISHED' });
    setTerms(res.data.terms || []);
  }}), [terms, loading]);

  return <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>;
};

export const useGlossary = () => {
  const ctx = useContext(GlossaryContext);
  if (!ctx) throw new Error('useGlossary must be used inside GlossaryProvider');
  return ctx;
};

