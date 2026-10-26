import 'server-only';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { getServerSession, type NextAuthOptions } from 'next-auth';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import type { Provider } from 'next-auth/providers/index';
import { prisma } from './db';

/*
 * Sign-in for the server edition (NextAuth): Google and Microsoft Entra ID, each enabled when its
 * credentials are set. AUTH_TEST_LOGIN=1 adds a password-less test account for automated tests;
 * never set it on a public server.
 */

const env = process.env;

function providers(): Provider[] {
  const list: Provider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    list.push(GoogleProvider({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }));
  }
  if (env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET) {
    list.push(AzureADProvider({
      clientId: env.AZURE_AD_CLIENT_ID,
      clientSecret: env.AZURE_AD_CLIENT_SECRET,
      tenantId: env.AZURE_AD_TENANT_ID || 'common',
      name: 'Microsoft',
    }));
  }
  if (env.AUTH_TEST_LOGIN === '1') {
    list.push(CredentialsProvider({
      id: 'test',
      name: 'Test account',
      credentials: { name: { label: 'Name', type: 'text' } },
      async authorize(credentials) {
        const name = (credentials?.name || 'Test user').slice(0, 40);
        const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@test.local`;
        const user = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name } });
        return { id: user.id, name: user.name, email: user.email };
      },
    }));
  }
  return list;
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: providers(),
  // JWT sessions (no session lookups per request); the adapter still stores users and accounts.
  session: { strategy: 'jwt' },
  secret: env.NEXTAUTH_SECRET,
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.id = (token.uid as string | undefined) ?? token.sub ?? '';
      return session;
    },
  },
};

/** The signed-in user's id, or null. */
export async function currentUserId() {
  const session = await getServerSession(authOptions);
  return session?.user?.id || null;
}
