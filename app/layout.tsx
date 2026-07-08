import '../styles/globals.css';
import '@livekit/components-styles';
import '@livekit/components-styles/prefabs';
import type { Metadata, Viewport } from 'next';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: {
    default: 'Fénix Live | Plataforma de video en vivo',
    template: '%s | Fénix Live',
  },
  description:
    'La plataforma de video en vivo de Fénix Academy. Únete a sesiones en vivo, webinars y reuniones privadas con César Escobar.',
  twitter: {
    creator: '@fenixacademy',
    site: '@fenixacademy',
    card: 'summary_large_image',
  },
  openGraph: {
    url: 'https://meet.academyfenix.com',
    images: [
      {
        url: 'https://meet.academyfenix.com/og-image.png',
        width: 1200,
        height: 630,
        type: 'image/png',
      },
    ],
    siteName: 'Fénix Live',
  },
  icons: {
    icon: {
      rel: 'icon',
      url: '/favicon.ico',
    },
  },
};

export const viewport: Viewport = {
  themeColor: '#C9A84C',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body data-lk-theme="default" style={{ background: '#0a0a0f' }}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
