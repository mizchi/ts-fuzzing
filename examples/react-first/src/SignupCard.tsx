export type SignupCardProps = {
  email: string;
  handle: string;
  plan: "free" | "pro";
};

export const SignupCard = ({ email, handle, plan }: SignupCardProps) => {
  return (
    <article data-plan={plan}>
      <h2>{handle}</h2>
      <p>{email}</p>
    </article>
  );
};
