'use client';

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { generateRoomId } from '@/lib/client-utils';

export default function Page() {
  const router = useRouter();
  const [roomName, setRoomName] = useState('');
  const [name, setName] = useState('');

  const joinRoom = () => {
    const room = roomName.trim() || generateRoomId();
    router.push(`/rooms/${room}`);
  };

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
      }}
    >
      {/* Logo / Marca */}
      <div style={{ textAlign: 'center', marginBottom: '48px' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '0.2em', color: '#C9A84C', textTransform: 'uppercase', margin: '0 0 12px' }}>
          FÉNIX ACADEMY
        </p>
        <h1 style={{ fontSize: '42px', fontWeight: 900, color: '#ffffff', margin: '0 0 8px', lineHeight: 1.1 }}>
          Fénix <span style={{ color: '#C9A84C' }}>Live</span>
        </h1>
        <p style={{ fontSize: '15px', color: '#6b6b8a', margin: 0 }}>
          Plataforma de video en vivo · academyfenix.com
        </p>
      </div>

      {/* Card */}
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#12121a',
          border: '1px solid rgba(201,168,76,0.2)',
          borderRadius: '16px',
          padding: '32px',
        }}
      >
        <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.12em', color: '#C9A84C', textTransform: 'uppercase', margin: '0 0 20px' }}>
          Unirse a una sala
        </p>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: '#6b6b8a', marginBottom: '6px' }}>
            Nombre de sala
          </label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            placeholder="fenix-webinar-julio"
            style={{
              width: '100%',
              padding: '12px 14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              color: '#ffffff',
              fontSize: '14px',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <button
          onClick={joinRoom}
          style={{
            width: '100%',
            padding: '14px',
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
          Entrar →
        </button>

        <p style={{ fontSize: '12px', color: '#3a3a5a', textAlign: 'center', margin: '16px 0 0' }}>
          Si no escribes un nombre se crea una sala aleatoria
        </p>
      </div>

      <p style={{ marginTop: '40px', fontSize: '11px', color: '#2a2a3d' }}>
        © Fénix Academy LLC · meet.academyfenix.com
      </p>
    </main>
  );
}
