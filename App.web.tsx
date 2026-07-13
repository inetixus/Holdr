import React, { useEffect, useState } from 'react';

export default function AppWeb() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div style={{ backgroundColor: '#050505', minHeight: '100vh', color: '#fff', fontFamily: '"Inter", -apple-system, sans-serif', overflowX: 'hidden' }}>
      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;800&family=Outfit:wght@700;900&display=swap');
        
        #root { width: 100%; display: block; }
        * { box-sizing: border-box; }
        body { margin: 0; background-color: #050505; color: #fff; width: 100%; overflow-x: hidden; }
        
        .nav {
          position: fixed;
          top: 0; left: 0; right: 0;
          padding: 20px 5%;
          display: flex; justify-content: space-between; align-items: center;
          z-index: 1000;
          transition: all 0.3s ease;
        }
        .nav.scrolled {
          background: rgba(5, 5, 5, 0.8);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding: 15px 5%;
        }
        .logo { font-family: 'Outfit', sans-serif; font-size: 28px; font-weight: 900; letter-spacing: -1px; cursor: pointer; }
        .logo span { color: #fb6e59; }
        
        .download-btn {
          background: #d9fb5a; color: #050505;
          padding: 12px 24px; border-radius: 30px;
          font-weight: 700; font-size: 14px;
          text-decoration: none;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .download-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(217, 251, 90, 0.2);
        }

        .hero {
          min-height: 100vh;
          display: flex; flex-direction: column; justify-content: center; align-items: center;
          text-align: center;
          padding: 140px 20px 60px;
          position: relative;
          max-width: 1200px;
          margin: 0 auto;
          gap: 40px;
        }
        
        @media (min-width: 900px) {
          .hero {
            flex-direction: row;
            text-align: left;
            justify-content: space-between;
            padding: 160px 5% 60px;
          }
          .hero-content {
            flex: 1;
            padding-right: 60px;
          }
          .phone-mockup {
            margin: 0 !important;
            flex-shrink: 0;
            transform: rotate(2deg);
          }
          h1 { font-size: clamp(50px, 6vw, 80px) !important; }
        }
        
        .blob {
          position: absolute;
          filter: blur(100px);
          z-index: 0;
          opacity: 0.5;
          animation: float 10s infinite ease-in-out alternate;
        }
        .blob-1 { width: 400px; height: 400px; background: #d9fb5a; top: -100px; left: -100px; }
        .blob-2 { width: 300px; height: 300px; background: #fb6e59; bottom: 10%; right: -50px; animation-delay: -5s; }
        .blob-3 { width: 350px; height: 350px; background: #b6e7d6; top: 40%; left: 20%; animation-duration: 15s; }

        @keyframes float {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(30px, 50px) scale(1.1); }
        }

        .hero-content {
          position: relative; z-index: 10;
          max-width: 800px;
        }
        .pill {
          background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);
          padding: 8px 16px; border-radius: 20px;
          font-size: 12px; font-weight: 600; letter-spacing: 1px;
          display: inline-block; margin-bottom: 30px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        h1 {
          font-family: 'Outfit', sans-serif;
          font-size: clamp(40px, 8vw, 80px);
          line-height: 1.1; margin: 0 0 24px;
          background: linear-gradient(to right, #fff, #a0a0a0);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .subtitle {
          font-size: clamp(16px, 2vw, 20px);
          color: #a0a0a0; line-height: 1.6;
          margin: 0 auto 40px; max-width: 600px;
        }
        @media (min-width: 900px) {
          .subtitle { margin: 0 0 40px; }
        }

        .features {
          display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 30px; padding: 40px 5%;
          max-width: 1200px; margin: 0 auto;
          position: relative; z-index: 10;
        }
        
        .feature-card {
          background: rgba(25, 25, 25, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 24px;
          padding: 40px;
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          transition: transform 0.3s, background 0.3s;
        }
        .feature-card:hover {
          transform: translateY(-10px);
          background: rgba(35, 35, 35, 0.8);
          border-color: rgba(255, 255, 255, 0.1);
        }
        
        .feature-icon {
          width: 60px; height: 60px; border-radius: 16px;
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; font-weight: bold; margin-bottom: 24px;
        }
        .icon-receipt { background: #b6e7d6; color: #050505; }
        .icon-deadline { background: #d9fb5a; color: #050505; }
        .icon-vault { background: #fb6e59; color: #fff; }
        
        .feature-card h3 { font-size: 24px; margin: 0 0 12px; font-family: 'Outfit', sans-serif; }
        .feature-card p { color: #a0a0a0; line-height: 1.6; margin: 0; }

        .phone-mockup {
          width: 320px; height: 650px;
          background: #000; border: 12px solid #1a1a1a;
          border-radius: 40px;
          margin: 0 auto;
          box-shadow: 0 30px 60px rgba(0,0,0,0.5), 0 0 100px rgba(217, 251, 90, 0.1);
          overflow: hidden;
          position: relative;
        }
        .phone-mockup-inner {
          padding: 20px;
          height: 100%;
          background: #f7f6f2;
          color: #172122;
          text-align: left;
          display: flex; flex-direction: column;
        }
        .mock-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 30px;
        }
        .mock-avatar { width: 40px; height: 40px; background: #fff; border-radius: 20px; border: 1px solid #172122; display:flex; align-items:center; justify-content:center; font-weight:800; font-size: 12px; }
        .mock-risk { background: #d9fb5a; border-radius: 8px; border: 1px solid #172122; padding: 15px; margin-bottom: 20px; box-shadow: 4px 4px 0px #172122; }
        .mock-item { border-bottom: 1px solid #dedfd9; padding: 15px 0; display: flex; align-items: center; gap: 12px; }
        .mock-icon { width: 42px; height: 42px; border-radius: 6px; background: #b6e7d6; display:flex; align-items:center; justify-content:center; font-weight:800; }
        
        .footer {
          border-top: 1px solid rgba(255,255,255,0.05);
          padding: 40px 5%; text-align: center; color: #666;
          margin-top: 80px;
        }
      `}} />

      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="logo">holdr<span>.</span></div>
        <a href="#" className="download-btn">Get Early Access</a>
      </nav>

      <div className="blob blob-1"></div>
      <div className="blob blob-2"></div>
      <div className="blob blob-3"></div>

      <header className="hero">
        <div className="hero-content">
          <div className="pill">COMING SOON TO iOS & ANDROID</div>
          <h1>Your money has a memory now.</h1>
          <p className="subtitle">
            A better place for the things you might lose. Receipts, returns, deals, and warranties. Finally all in one spot, right in your pocket.
          </p>
          <a href="#" className="download-btn" style={{ fontSize: '16px', padding: '16px 32px', display: 'inline-block' }}>Join the Waitlist</a>
        </div>

        <div className="phone-mockup">
          <div className="phone-mockup-inner">
            <div className="mock-header">
              <div>
                <div style={{ fontSize: '10px', color: '#64716e', fontWeight: 700, letterSpacing: '0.5px' }}>TODAY</div>
                <div style={{ fontSize: '26px', fontWeight: 800, marginTop: 2 }}>Hey, Alex.</div>
              </div>
              <div className="mock-avatar">AL</div>
            </div>
            <div className="mock-risk">
              <div style={{ fontSize: '10px', fontWeight: 800, color: '#38572e' }}>AT RISK THIS WEEK</div>
              <div style={{ fontSize: '38px', fontWeight: 800, marginTop: 4 }}>$62.50</div>
              <div style={{ fontSize: '12px', color: '#42612d', marginTop: 4 }}>across 2 upcoming items</div>
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, marginTop: 15, marginBottom: 5 }}>Coming up</div>
            <div className="mock-item">
              <div className="mock-icon" style={{ background: '#b6e7d6' }}>R</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '16px' }}>Amazon</div>
                <div style={{ fontSize: '12px', color: '#64716e', marginTop: 2 }}>$42.50 return</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', fontWeight: 800, color: '#bd3221' }}>2 days left</div>
                <div style={{ fontSize: '11px', color: '#64716e', marginTop: 2 }}>Aug 12</div>
              </div>
            </div>
            <div className="mock-item" style={{ borderBottom: 'none' }}>
              <div className="mock-icon" style={{ background: '#ffd7cf' }}>%</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '16px' }}>Target</div>
                <div style={{ fontSize: '12px', color: '#64716e', marginTop: 2 }}>20% off</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', fontWeight: 800, color: '#64716e' }}>5 days left</div>
                <div style={{ fontSize: '11px', color: '#64716e', marginTop: 2 }}>Aug 15</div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <section className="features">
        <div className="feature-card">
          <div className="feature-icon icon-receipt">R</div>
          <h3>Never miss a return</h3>
          <p>Holdr spots the important date on your receipts and nudges you before it's too late to get your money back.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon icon-deadline">%</div>
          <h3>Deals that don't expire</h3>
          <p>Save that 20% off coupon once. Stop thinking about it. We'll remind you to use it the next time you're shopping.</p>
        </div>
        <div className="feature-card">
          <div className="feature-icon icon-vault">OK</div>
          <h3>Your secure vault</h3>
          <p>Snap a photo, forward an email, and get back to your day. Everything is securely stored in your personal vault.</p>
        </div>
      </section>

      <footer className="footer">
        <p>&copy; {new Date().getFullYear()} Holdr App. All rights reserved.</p>
      </footer>
    </div>
  );
}
