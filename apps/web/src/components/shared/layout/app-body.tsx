type AppBodyProps = {
  children: React.ReactNode;
};

export function AppBody({children}: AppBodyProps) {
  return <div className='mx-auto max-w-[80rem] sm:px-4'>{children}</div>;
}
