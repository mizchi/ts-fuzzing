export type ContactCardProps = {
  /**
   * @fuzz.pattern email
   */
  email: string;
  /**
   * @fuzz.pattern url
   */
  homepage: string;
};

export const ContactCard = ({ email, homepage }: ContactCardProps) => {
  if (!email.includes("@")) {
    throw new Error("invalid email");
  }
  const url = new URL(homepage);
  return (
    <a href={url.toString()}>
      {email}
    </a>
  );
};
