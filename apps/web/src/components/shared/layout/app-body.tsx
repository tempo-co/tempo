type AppBodyLayoutProps = {
  children: React.ReactNode;
};

/** Every signed-in page's column. Pages don't adjust it, so titles and content start in the same place. */
export function AppBodyLayout({children}: AppBodyLayoutProps) {
  return <div className='mx-auto my-8 max-w-7xl px-4 max-md:my-6'>{children}</div>;
}
