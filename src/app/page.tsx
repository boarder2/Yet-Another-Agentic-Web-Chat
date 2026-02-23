import ChatWindow from '@/components/ChatWindow';
import { Metadata } from 'next';
import { Suspense } from 'react';

export const metadata: Metadata = {
  title: 'Chat - YAAWC',
  description: 'Chat with the internet, chat with YAAWC.',
};

const Home = () => {
  return (
    <div>
      <Suspense>
        <ChatWindow key="new" />
      </Suspense>
    </div>
  );
};

export default Home;
