type AppBodyLayoutProps = {
  children: React.ReactNode;
};

export function AppBodyLayout({children}: AppBodyLayoutProps) {
  return <div className='mx-auto max-w-[80rem] sm:px-4'>{children}</div>;
}
