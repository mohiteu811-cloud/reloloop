import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from './prisma';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Resend({
      // Resend creds come from infra/.env.example. If RESEND_API_KEY
      // isn't set the provider will throw at signin time, not boot —
      // intentional, so /api/health and unauth pages still work even
      // without email wired up.
      apiKey: process.env.RESEND_API_KEY ?? '',
      from: process.env.EMAIL_FROM ?? 'noreply@livinloop.com',
    }),
  ],
  pages: {
    signIn: '/signin',
    verifyRequest: '/signin/check-email',
  },
  session: { strategy: 'jwt' },
});
