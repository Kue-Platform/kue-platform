import { Controller, Get, Header } from '@nestjs/common';

@Controller()
export class AppController {
    @Get()
    @Header('content-type', 'text/html')
    getHello(): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kue Platform | System Status</title>
    <meta name="description" content="Kue Platform - Professional Network Intelligence API for modern businesses">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-primary: #030712;
            --bg-secondary: #0f172a;
            --card-bg: rgba(15, 23, 42, 0.7);
            --accent-primary: #6366f1;
            --accent-secondary: #8b5cf6;
            --accent-tertiary: #06b6d4;
            --accent-glow: rgba(99, 102, 241, 0.25);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --success: #10b981;
            --success-glow: rgba(16, 185, 129, 0.3);
            --border-subtle: rgba(148, 163, 184, 0.1);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow-x: hidden;
            position: relative;
        }

        /* Animated gradient background */
        .bg-gradient {
            position: fixed;
            inset: 0;
            background: 
                radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99, 102, 241, 0.15), transparent),
                radial-gradient(ellipse 60% 40% at 100% 100%, rgba(139, 92, 246, 0.1), transparent),
                radial-gradient(ellipse 50% 30% at 0% 100%, rgba(6, 182, 212, 0.08), transparent);
            z-index: 0;
        }

        /* Floating orbs */
        .orb {
            position: absolute;
            border-radius: 50%;
            filter: blur(60px);
            opacity: 0.4;
            animation: float 20s ease-in-out infinite;
        }

        .orb-1 {
            width: 400px;
            height: 400px;
            background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
            top: -100px;
            left: 20%;
            animation-delay: 0s;
        }

        .orb-2 {
            width: 300px;
            height: 300px;
            background: linear-gradient(135deg, var(--accent-secondary), var(--accent-tertiary));
            bottom: -50px;
            right: 10%;
            animation-delay: -7s;
        }

        .orb-3 {
            width: 200px;
            height: 200px;
            background: var(--accent-tertiary);
            top: 40%;
            left: -50px;
            animation-delay: -14s;
        }

        @keyframes float {
            0%, 100% { transform: translate(0, 0) scale(1); }
            25% { transform: translate(30px, -30px) scale(1.05); }
            50% { transform: translate(-20px, 20px) scale(0.95); }
            75% { transform: translate(40px, 10px) scale(1.02); }
        }

        .container {
            position: relative;
            z-index: 10;
            text-align: center;
            max-width: 700px;
            width: 90%;
            padding: 20px;
        }

        /* Logo & Brand */
        .brand {
            margin-bottom: 2rem;
            animation: fadeInDown 0.8s ease-out;
        }

        .logo {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 80px;
            height: 80px;
            background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
            border-radius: 20px;
            margin-bottom: 1.5rem;
            box-shadow: 0 20px 40px -10px var(--accent-glow);
            position: relative;
            overflow: hidden;
        }

        .logo::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.2));
        }

        .logo svg {
            width: 40px;
            height: 40px;
            fill: white;
        }

        @keyframes fadeInDown {
            from { opacity: 0; transform: translateY(-30px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Glass Card */
        .glass-card {
            background: var(--card-bg);
            backdrop-filter: blur(40px);
            -webkit-backdrop-filter: blur(40px);
            border: 1px solid var(--border-subtle);
            border-radius: 28px;
            padding: 48px 40px;
            box-shadow: 
                0 0 0 1px rgba(255, 255, 255, 0.05) inset,
                0 25px 50px -12px rgba(0, 0, 0, 0.4);
            animation: floatUp 1s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes floatUp {
            from { opacity: 0; transform: translateY(40px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* Status Indicator */
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            background: rgba(16, 185, 129, 0.08);
            border: 1px solid rgba(16, 185, 129, 0.2);
            padding: 10px 20px;
            border-radius: 100px;
            margin-bottom: 2rem;
            transition: all 0.3s ease;
        }

        .status-badge:hover {
            background: rgba(16, 185, 129, 0.15);
            transform: translateY(-2px);
        }

        .status-dot {
            width: 10px;
            height: 10px;
            background: var(--success);
            border-radius: 50%;
            box-shadow: 0 0 12px var(--success-glow), 0 0 24px var(--success-glow);
            animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(0.9); }
        }

        .status-text {
            color: var(--success);
            font-size: 0.8rem;
            font-weight: 600;
            letter-spacing: 0.1em;
            text-transform: uppercase;
        }

        /* Typography */
        h1 {
            font-size: clamp(2.5rem, 6vw, 3.5rem);
            font-weight: 700;
            letter-spacing: -0.03em;
            margin-bottom: 0.75rem;
            background: linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .tagline {
            color: var(--text-secondary);
            font-size: 1.15rem;
            font-weight: 400;
            margin-bottom: 2.5rem;
            line-height: 1.6;
        }

        /* Feature Pills */
        .features {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: 12px;
            margin-bottom: 2.5rem;
        }

        .feature-pill {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--border-subtle);
            padding: 8px 16px;
            border-radius: 100px;
            font-size: 0.85rem;
            color: var(--text-secondary);
            transition: all 0.2s ease;
        }

        .feature-pill:hover {
            background: rgba(255, 255, 255, 0.06);
            color: var(--text-primary);
            transform: translateY(-2px);
        }

        .feature-pill svg {
            width: 16px;
            height: 16px;
            opacity: 0.7;
        }

        /* Buttons */
        .actions {
            display: flex;
            justify-content: center;
            gap: 16px;
            flex-wrap: wrap;
        }

        .btn {
            text-decoration: none;
            padding: 14px 28px;
            border-radius: 14px;
            font-weight: 600;
            font-size: 0.95rem;
            transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
            display: inline-flex;
            align-items: center;
            gap: 10px;
            position: relative;
            overflow: hidden;
        }

        .btn-primary {
            background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
            color: white;
            box-shadow: 0 10px 30px -5px var(--accent-glow);
        }

        .btn-primary::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.15));
            opacity: 0;
            transition: opacity 0.3s;
        }

        .btn-primary:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 40px -5px var(--accent-glow);
        }

        .btn-primary:hover::before {
            opacity: 1;
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.04);
            color: var(--text-primary);
            border: 1px solid var(--border-subtle);
        }

        .btn-secondary:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-3px);
        }

        .btn svg {
            width: 18px;
            height: 18px;
        }

        /* Footer */
        .footer {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
            color: var(--text-muted);
            font-size: 0.8rem;
            letter-spacing: 0.05em;
        }

        .footer span {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .footer-dot {
            width: 4px;
            height: 4px;
            background: var(--text-muted);
            border-radius: 50%;
        }

        /* Responsive */
        @media (max-width: 600px) {
            .glass-card {
                padding: 32px 24px;
            }
            
            .actions {
                flex-direction: column;
            }
            
            .btn {
                width: 100%;
                justify-content: center;
            }

            .features {
                gap: 8px;
            }

            .feature-pill {
                padding: 6px 12px;
                font-size: 0.8rem;
            }
        }
    </style>
</head>
<body>
    <div class="bg-gradient"></div>
    <div class="orb orb-1"></div>
    <div class="orb orb-2"></div>
    <div class="orb orb-3"></div>

    <div class="container">
        <div class="brand">
            <div class="logo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
            </div>
        </div>
        
        <div class="glass-card">
            <div class="status-badge" id="status-badge">
                <div class="status-dot" id="status-dot"></div>
                <div class="status-text" id="status-text">All Systems Operational</div>
            </div>
            
            <h1>Kue Platform</h1>
            <p class="tagline">Professional Network Intelligence API powering next-generation relationship management</p>
            
            <div class="features">
                <div class="feature-pill">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    Contact Sync
                </div>
                <div class="feature-pill">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    AI Enrichment
                </div>
                <div class="feature-pill">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                    Graph Database
                </div>
                <div class="feature-pill">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    OAuth 2.0
                </div>
            </div>
            
            <div class="actions">
                <a href="/api/docs" class="btn btn-primary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                    </svg>
                    API Documentation
                </a>
                <a href="/health" class="btn btn-secondary">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                    </svg>
                    Health Check
                </a>
            </div>
        </div>
    </div>

    <div class="footer">
        <span>V0.1.0</span>
        <div class="footer-dot"></div>
        <span>Powered by NestJS</span>
        <div class="footer-dot"></div>
        <span>© 2026 Kue Platform</span>
    </div>
    
    <script>
        // Real-time health check
        async function checkHealth() {
            const dot = document.getElementById('status-dot');
            const text = document.getElementById('status-text');
            const badge = document.getElementById('status-badge');
            
            try {
                const res = await fetch('/health/liveness');
                if (res.ok) {
                    dot.style.background = '#10b981';
                    dot.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.3), 0 0 24px rgba(16, 185, 129, 0.3)';
                    text.style.color = '#10b981';
                    text.textContent = 'All Systems Operational';
                    badge.style.background = 'rgba(16, 185, 129, 0.08)';
                    badge.style.borderColor = 'rgba(16, 185, 129, 0.2)';
                } else {
                    showDegraded();
                }
            } catch (err) {
                showOffline();
            }
        }
        
        function showDegraded() {
            const dot = document.getElementById('status-dot');
            const text = document.getElementById('status-text');
            const badge = document.getElementById('status-badge');
            
            dot.style.background = '#f59e0b';
            dot.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.3)';
            text.style.color = '#f59e0b';
            text.textContent = 'Degraded Performance';
            badge.style.background = 'rgba(245, 158, 11, 0.08)';
            badge.style.borderColor = 'rgba(245, 158, 11, 0.2)';
        }
        
        function showOffline() {
            const dot = document.getElementById('status-dot');
            const text = document.getElementById('status-text');
            const badge = document.getElementById('status-badge');
            
            dot.style.background = '#ef4444';
            dot.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.3)';
            text.style.color = '#ef4444';
            text.textContent = 'System Offline';
            badge.style.background = 'rgba(239, 68, 68, 0.08)';
            badge.style.borderColor = 'rgba(239, 68, 68, 0.2)';
        }
        
        // Check on load
        checkHealth();
        
        // Recheck every 30 seconds
        setInterval(checkHealth, 30000);
    </script>
</body>
</html>
    `;
    }
}
