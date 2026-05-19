type ModuleHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function ModuleHeader({ eyebrow, title, description }: ModuleHeaderProps) {
  return (
    <header className="module-header">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}
