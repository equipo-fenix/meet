'use client';

import React from 'react';

export default function SalirPage() {
  React.useEffect(() => {
    // Intentar cerrar la pestaña si fue abierta por el link del webinar
    // Solo funciona si la pestaña fue abierta por script (no por usuario directamente)
    window.close();
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#0a0a0f',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Arial, sans-serif',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      {/* Ícono */}
      <div style={{ marginBottom: '32px' }}>
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.05))',
            border: '1px solid rgba(201,168,76,0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
            fontSize: '32px',
          }}
        >
          ✓
        </div>
      </div>

      {/* Texto principal */}
      <p
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '0.2em',
          color: '#C9A84C',
          textTransform: 'uppercase',
          margin: '0 0 12px',
        }}
      >
        FÉNIX ACADEMY
      </p>
      <h1
        style={{
          fontSize: '32px',
          fontWeight: 900,
          color: '#ffffff',
          margin: '0 0 12px',
          lineHeight: 1.2,
        }}
      >
        Sesión finalizada
      </h1>
      <p style={{ fontSize: '16px', color: '#6b6b8a', margin: '0 0 40px', maxWidth: '320px' }}>
        Gracias por participar. Nos vemos en el próximo webinar.
      </p>

      {/* Botón cerrar */}
      <button
        onClick={() => window.close()}
        style={{
          padding: '14px 32px',
          background: 'linear-gradient(135deg, #C9A84C, #a07830)',
          color: '#0a0a0f',
          border: 'none',
          borderRadius: '10px',
          fontSize: '15px',
          fontWeight: 900,
          cursor: 'pointer',
          letterSpacing: '0.02em',
        }}
      >
        Cerrar ventana
      </button>

      <p style={{ marginTop: '48px', fontSize: '11px', color: '#2a2a3d' }}>
        © Fénix Academy LLC · academyfenix.com
      </p>
    </main>
  );
}
