type AppBodyLayoutProps = {
  children: React.ReactNode;
};

export function AppBodyLayout({children}: AppBodyLayoutProps) {
  return <div className='mx-auto mb-8 max-w-[80rem] px-4'>{children}</div>;
}
