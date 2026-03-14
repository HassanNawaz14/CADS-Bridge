import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/* ── tiny hook: animate number counting up ── */
const useCountUp = (target, duration = 1800, start = false) => {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let startTime = null;
    const step = (ts) => {
      if (!startTime) startTime = ts;
      const progress = Math.min((ts - startTime) / duration, 1);
      setVal(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, start]);
  return val;
};

/* ── Intersection observer hook ── */
const useInView = (threshold = 0.2) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, inView];
};

/* ── Stat counter card ── */
const StatCard = ({ number, suffix, label, color, start }) => {
  const val = useCountUp(number, 1600, start);
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'Syne', fontSize: '3rem', fontWeight: 800, color, lineHeight: 1 }}>
        {val}{suffix}
      </div>
      <div style={{ color: 'rgba(245,243,238,0.45)', fontSize: '0.9rem', marginTop: '0.4rem' }}>{label}</div>
    </div>
  );
};

const Landing = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [statsRef, statsInView] = useInView(0.3);
  const [menuOpen, setMenuOpen] = useState(false);

  // Already logged in → go to dashboard
  useEffect(() => {
    if (user) navigate('/dashboard', { replace: true });
  }, [user, navigate]);

  const features = [
    {
      icon: '🔐',
      title: 'Isolated Firm Environments',
      desc: 'Every organisation gets a completely isolated environment with a unique access code. Zero data bleed between firms, ever.',
      color: 'var(--ca)',
    },
    {
      icon: '📊',
      title: 'KPI Command Centre',
      desc: 'Side-by-side performance metrics for CA and DS teams. Automated flagging when any member dips below threshold.',
      color: 'var(--ds)',
    },
    {
      icon: '🗂️',
      title: 'Tamper-Proof Audit Trails',
      desc: 'Every action is logged with actor identity, timestamp, and IP. Read-only, filterable, and compliance-ready from day one.',
      color: 'var(--ca)',
    },
    {
      icon: '🚀',
      title: 'Shared Project Workspaces',
      desc: 'Admin-approved cross-functional workspaces with real-time messaging, file sharing, and a kanban task board.',
      color: 'var(--ds)',
    },
    {
      icon: '🤝',
      title: 'Role-Based Access Control',
      desc: 'CAs see their dashboard in blue. DSs see theirs in orange. No role switching. No accidental access to the wrong team\'s data.',
      color: 'var(--ca)',
    },
    {
      icon: '⚡',
      title: 'Real-Time Collaboration',
      desc: 'Socket.IO-powered live messaging and instant notifications mean your teams stay in sync without switching tools.',
      color: 'var(--ds)',
    },
  ];

  const steps = [
    { num: '01', title: 'Book Your Environment', desc: 'Register your firm and get a unique environment code in under 2 minutes.', icon: '🏢' },
    { num: '02', title: 'Set Up Admin Accounts', desc: 'Create one CA Lead and one DS Lead administrator for your firm.', icon: '👑' },
    { num: '03', title: 'Onboard Your Teams', desc: 'Invite CA and DS members. Admins approve access requests.', icon: '👥' },
    { num: '04', title: 'Start Collaborating', desc: 'Create projects, track KPIs, and ship better work together.', icon: '🚀' },
  ];

  const testimonials = [
    { quote: 'Our CA and DS teams were working in completely separate silos. CADS-Bridge gave us one shared language and workflow.', name: 'Fatima Malik', role: 'CFO, Nexus Capital', initials: 'FM', team: 'CA' },
    { quote: 'The audit trail feature alone made compliance reporting a 10x faster process. Every action is traceable to the second.', name: 'Bilal Chaudhry', role: 'Head of Data Science, Meridian Analytics', initials: 'BC', team: 'DS' },
    { quote: 'We onboarded 40 team members across both disciplines in a single afternoon. The environment setup is genuinely frictionless.', name: 'Sara Qureshi', role: 'Operations Director, Summit Consulting', initials: 'SQ', team: 'CA' },
  ];

  return (
    <div style={{ background: 'var(--paper)', color: 'var(--ink)', overflowX: 'hidden' }}>

      {/* ── NAVBAR ── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 200,
        padding: '0 2.5rem',
        height: 64,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(245,243,238,0.9)',
        backdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.02em' }}>
          <span style={{ color: 'var(--ca)' }}>CA</span>
          <span>DS</span>
          <span style={{ color: 'var(--ds)' }}>-Bridge</span>
        </div>

        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <a href="#features" style={{ fontSize: '0.88rem', color: 'var(--muted)', fontWeight: 500, textDecoration: 'none' }}>Features</a>
          <a href="#how-it-works" style={{ fontSize: '0.88rem', color: 'var(--muted)', fontWeight: 500, textDecoration: 'none' }}>How it works</a>
          <a href="#testimonials" style={{ fontSize: '0.88rem', color: 'var(--muted)', fontWeight: 500, textDecoration: 'none' }}>Testimonials</a>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link to="/login" className="btn btn-ghost btn-sm">Sign In</Link>
          <Link to="/onboarding" className="btn btn-primary btn-sm">Get Started →</Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        minHeight: '100vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '8rem 2.5rem 5rem',
        background: 'var(--paper)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background decorative blobs */}
        <div style={{ position: 'absolute', top: '15%', left: '-5%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(26,107,255,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '-5%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,107,53,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ maxWidth: 820, textAlign: 'center', position: 'relative', zIndex: 1 }}>
          {/* Eyebrow tag */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            background: 'white',
            border: '1.5px solid var(--border)',
            borderRadius: '2rem',
            padding: '0.35rem 1rem',
            fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)',
            marginBottom: '2rem',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />
            Purpose-built for enterprise CA & DS teams
          </div>

          <h1 style={{
            fontFamily: 'Syne', fontSize: 'clamp(2.8rem, 6vw, 5rem)',
            fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1,
            marginBottom: '1.5rem',
          }}>
            Where Finance<br />
            <span style={{ color: 'var(--ca)' }}>Meets</span>{' '}
            <span style={{ color: 'var(--ds)' }}>Intelligence</span>
          </h1>

          <p style={{
            fontSize: 'clamp(1rem, 2vw, 1.2rem)',
            color: 'var(--muted)', lineHeight: 1.75,
            maxWidth: 600, margin: '0 auto 2.5rem',
          }}>
            CADS-Bridge unifies Chartered Accountants and Data Scientists in one
            secure, auditable collaboration platform — built for the way enterprise
            teams actually work.
          </p>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/onboarding" className="btn btn-primary" style={{ padding: '0.85rem 2.25rem', fontSize: '0.95rem' }}>
              Book Your Environment →
            </Link>
            <Link to="/login" className="btn btn-ghost" style={{ padding: '0.85rem 2rem', fontSize: '0.95rem' }}>
              Sign In to Existing Firm
            </Link>
          </div>

          <p style={{ fontSize: '0.78rem', color: 'var(--muted)', marginTop: '1rem' }}>
            Free to set up · No credit card required · Isolated per firm
          </p>
        </div>
      </section>

      {/* ── STATS BAND ── */}
      <section ref={statsRef} style={{
        background: 'var(--ink)', color: 'var(--paper)',
        padding: '4rem 2.5rem',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2rem' }}>
          <StatCard number={500}  suffix="+"  label="Firms onboarded"         color="var(--ca)" start={statsInView} />
          <StatCard number={12000} suffix="+" label="Team members active"     color="var(--ds)" start={statsInView} />
          <StatCard number={99}   suffix="%"  label="Audit log accuracy"      color="var(--success)" start={statsInView} />
          <StatCard number={3}    suffix="s"  label="Avg dashboard load time" color="rgba(245,243,238,0.7)" start={statsInView} />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" style={{ padding: '6rem 2.5rem' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ca)', marginBottom: '0.75rem' }}>
              Platform Features
            </div>
            <h2 style={{ fontFamily: 'Syne', fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: 800, letterSpacing: '-0.025em', marginBottom: '1rem' }}>
              Everything your teams need.<br />Nothing they don't.
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: '1.05rem', maxWidth: 520, margin: '0 auto' }}>
              Built specifically for the CA–DS collaboration workflow. Not a generic project tool bolted on top of a spreadsheet.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
            {features.map((f) => (
              <div key={f.title} className="card" style={{ padding: '2rem', transition: 'transform 0.2s, box-shadow 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
              >
                <div style={{ width: 48, height: 48, borderRadius: 12, background: `${f.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', marginBottom: '1.25rem' }}>
                  {f.icon}
                </div>
                <h3 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '1rem', marginBottom: '0.6rem' }}>{f.title}</h3>
                <p style={{ color: 'var(--muted)', fontSize: '0.875rem', lineHeight: 1.65 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" style={{ padding: '6rem 2.5rem', background: 'white' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '4rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ds)', marginBottom: '0.75rem' }}>
              Getting Started
            </div>
            <h2 style={{ fontFamily: 'Syne', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.025em' }}>
              Up and running in minutes
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', position: 'relative' }}>
            {/* Connector line */}
            <div style={{ position: 'absolute', top: 28, left: '12.5%', right: '12.5%', height: 2, background: 'linear-gradient(90deg, var(--ca), var(--ds))', zIndex: 0, borderRadius: 1 }} />

            {steps.map((s, i) => (
              <div key={s.num} style={{ textAlign: 'center', position: 'relative', zIndex: 1 }}>
                <div style={{
                  width: 56, height: 56, borderRadius: '50%',
                  background: i < 2 ? 'var(--ca)' : 'var(--ds)',
                  color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.4rem', margin: '0 auto 1.25rem',
                  boxShadow: `0 4px 16px ${i < 2 ? 'rgba(26,107,255,0.3)' : 'rgba(255,107,53,0.3)'}`,
                }}>
                  {s.icon}
                </div>
                <div style={{ fontFamily: 'Syne', fontSize: '0.65rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>
                  STEP {s.num}
                </div>
                <h4 style={{ fontFamily: 'Syne', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>{s.title}</h4>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.6 }}>{s.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '3.5rem' }}>
            <Link to="/onboarding" className="btn btn-primary" style={{ padding: '0.85rem 2.5rem', fontSize: '0.95rem' }}>
              Start Your Firm's Environment →
            </Link>
          </div>
        </div>
      </section>

      {/* ── TWO DASHBOARDS PREVIEW ── */}
      <section style={{ padding: '6rem 2.5rem' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <h2 style={{ fontFamily: 'Syne', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.025em', marginBottom: '1rem' }}>
              Two teams. One platform.
            </h2>
            <p style={{ color: 'var(--muted)', fontSize: '1.05rem', maxWidth: 500, margin: '0 auto' }}>
              Each team gets a dashboard designed for their workflow — without ever seeing the other team's sensitive data.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {/* CA card */}
            <div style={{ background: 'var(--ink)', borderRadius: 'var(--radius-lg)', padding: '2rem', border: '2px solid rgba(26,107,255,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--ca)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'white', fontSize: '0.85rem', fontFamily: 'Syne' }}>CA</div>
                <div>
                  <div style={{ fontFamily: 'Syne', fontWeight: 700, color: 'var(--paper)' }}>CA Dashboard</div>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(245,243,238,0.4)' }}>Chartered Accountants</div>
                </div>
                <span style={{ marginLeft: 'auto', background: 'rgba(26,107,255,0.2)', color: '#6ea8fe', padding: '0.2rem 0.65rem', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: 700 }}>CA</span>
              </div>
              {['📒 Financial KPI metrics', '🗂️ Audit trail management', '📋 Task board & assignments', '🚀 Cross-functional projects'].map((item) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.85rem', color: 'rgba(245,243,238,0.65)' }}>
                  {item}
                </div>
              ))}
            </div>

            {/* DS card */}
            <div style={{ background: 'var(--ink)', borderRadius: 'var(--radius-lg)', padding: '2rem', border: '2px solid rgba(255,107,53,0.3)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--ds)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: 'white', fontSize: '0.85rem', fontFamily: 'Syne' }}>DS</div>
                <div>
                  <div style={{ fontFamily: 'Syne', fontWeight: 700, color: 'var(--paper)' }}>DS Dashboard</div>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(245,243,238,0.4)' }}>Data Scientists</div>
                </div>
                <span style={{ marginLeft: 'auto', background: 'rgba(255,107,53,0.2)', color: '#ffad8a', padding: '0.2rem 0.65rem', borderRadius: '1rem', fontSize: '0.7rem', fontWeight: 700 }}>DS</span>
              </div>
              {['🔬 Model performance metrics', '⚡ Pipeline uptime tracking', '📊 Prediction delivery rates', '🚀 Cross-functional projects'].map((item) => (
                <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.85rem', color: 'rgba(245,243,238,0.65)' }}>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── TESTIMONIALS ── */}
      <section id="testimonials" style={{ padding: '6rem 2.5rem', background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '3.5rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ca)', marginBottom: '0.75rem' }}>Testimonials</div>
            <h2 style={{ fontFamily: 'Syne', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800, letterSpacing: '-0.025em' }}>
              Trusted by finance & data teams
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
            {testimonials.map((t) => (
              <div key={t.name} className="card" style={{ padding: '1.75rem' }}>
                <div style={{ fontSize: '1.5rem', color: 'var(--ca)', marginBottom: '1rem', fontFamily: 'Georgia', lineHeight: 1 }}>"</div>
                <p style={{ fontSize: '0.88rem', lineHeight: 1.7, color: 'var(--ink)', marginBottom: '1.25rem' }}>{t.quote}</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                  <div className={`avatar avatar-md avatar-${t.team.toLowerCase()}`}>{t.initials}</div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{t.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BAND ── */}
      <section style={{ padding: '6rem 2.5rem', background: 'var(--ink)', textAlign: 'center' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h2 style={{ fontFamily: 'Syne', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: 800, color: 'var(--paper)', letterSpacing: '-0.03em', marginBottom: '1rem' }}>
            Ready to bridge your teams?
          </h2>
          <p style={{ color: 'rgba(245,243,238,0.5)', fontSize: '1.05rem', lineHeight: 1.7, marginBottom: '2.5rem' }}>
            Provision your firm's environment in minutes. Your CA and DS teams will be collaborating in a single, auditable workspace today.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/onboarding" className="btn btn-ca" style={{ padding: '0.9rem 2.5rem', fontSize: '0.95rem' }}>
              Book Environment →
            </Link>
            <Link to="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.9rem 2rem', borderRadius: '2rem', border: '1.5px solid rgba(255,255,255,0.15)', color: 'rgba(245,243,238,0.6)', fontSize: '0.95rem', fontWeight: 500, transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--paper)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(245,243,238,0.6)'}
            >
              Already have a firm? Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ background: 'var(--ink)', borderTop: '1px solid rgba(255,255,255,0.06)', padding: '2rem 2.5rem' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--ca)' }}>CA</span>
            <span style={{ color: 'rgba(245,243,238,0.5)' }}>DS</span>
            <span style={{ color: 'var(--ds)' }}>-Bridge</span>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'rgba(245,243,238,0.3)' }}>
            © {new Date().getFullYear()} CADS-Bridge. Built for enterprise CA & DS collaboration.
          </div>
        </div>
      </footer>

    </div>
  );
};

export default Landing;
