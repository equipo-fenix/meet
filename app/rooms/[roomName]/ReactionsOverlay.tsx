'use client';

/**
 * ReactionsOverlay — Los emojis subiendo por el escenario
 *
 * Va por encima del vídeo pero sin capturarlo: `pointer-events: none` en todo
 * el bloque. Si un emoji se comiera un clic, taparía el botón de fijar a
 * alguien en el escenario justo cuando la sala está más animada.
 */

import React from 'react';
import type { ReaccionVolando } from '@/lib/useReactions';

export function ReactionsOverlay({ reacciones }: { reacciones: ReaccionVolando[] }) {
  if (reacciones.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      {reacciones.map((r) => (
        <div
          key={r.key}
          className="fenix-reaccion"
          style={{ left: `${r.left}%` }}
          // El nombre va debajo del emoji, como en Zoom: un aplauso anónimo no
          // sirve de nada cuando el anfitrión quiere saber a quién responder.
        >
          <span style={{ fontSize: '40px', lineHeight: 1 }}>{r.emoji}</span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#fff',
              background: 'rgba(0,0,0,0.55)',
              borderRadius: '10px',
              padding: '2px 8px',
              maxWidth: '130px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {r.name}
          </span>
        </div>
      ))}

      <style>{`
        .fenix-reaccion {
          position: absolute;
          bottom: 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          animation: fenix-subir 4s ease-out forwards;
          will-change: transform, opacity;
        }
        @keyframes fenix-subir {
          0%   { transform: translateY(0)      scale(0.6); opacity: 0; }
          12%  { transform: translateY(-30px)  scale(1.15); opacity: 1; }
          22%  { transform: translateY(-60px)  scale(1);    opacity: 1; }
          75%  { transform: translateY(-260px) scale(1);    opacity: 1; }
          100% { transform: translateY(-360px) scale(0.85); opacity: 0; }
        }
        /* Para quien pidió que el sistema no le anime nada: el emoji aparece,
           se queda un momento y se va, sin recorrer la pantalla. */
        @media (prefers-reduced-motion: reduce) {
          .fenix-reaccion { animation: fenix-asomar 4s ease-out forwards; }
          @keyframes fenix-asomar {
            0%, 100% { opacity: 0; }
            10%, 80% { opacity: 1; }
          }
        }
      `}</style>
    </div>
  );
}
