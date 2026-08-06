import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]';
export const getSession = () => getServerSession(authOptions);
