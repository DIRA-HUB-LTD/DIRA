import Image from "next/image";

const TEAM = [
  {
    name: "Irene Muchira",
    role: "Founder · Product",
    photo: "/images/team/irene-muchira.jpg",
    bio: [
      "Senior software engineer with six years of experience, and DIRA's product owner.",
      "A serial founder: DIRA, Anza, The Mansion Dance Studio, and the nonprofit Inspiring Revolution.",
      "Teaching children at The Mansion showed her what parents value most: a teacher who truly knows their child.",
    ],
  },
  {
    name: "Jacinta Muki",
    role: "Data & AI",
    photo: "/images/team/jacinta-muki.jpg",
    bio: [
      "Data scientist and AI engineer, and a senior fraud analyst at Equity Bank, where finding the real signal in large records is the job.",
      "Education runs in her family: four of her close relatives direct schools and several more teach, so she knows the classrooms DIRA is built for.",
    ],
  },
  {
    name: "Michelle Gatti",
    role: "Platform, integrations & security",
    photo: "/images/team/michelle-gatti.jpg",
    bio: [
      "Software engineer with six years of experience in DevOps and site reliability, at Safaricom.",
      "She keeps DIRA's integrations, uptime and data security dependable on every school day.",
    ],
  },
];

/** Who builds DIRA. Shown at the foot of the landing page. */
export default function TeamSection() {
  return (
    <section aria-labelledby="team-heading">
      <h2 id="team-heading" className="text-2xl font-bold text-dira-teal-deep dark:text-gray-50">
        The team behind DIRA
      </h2>
      <p className="mt-2 max-w-2xl text-gray-700 dark:text-gray-300">
        Engineers who have built and run real services, with classrooms in the family.
      </p>
      <div className="mt-8 grid gap-6 md:grid-cols-3">
        {TEAM.map((person) => (
          <article
            key={person.name}
            className="flex flex-col rounded-xl border border-dira-teal/15 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
          >
            <Image
              src={person.photo}
              alt={`Portrait of ${person.name}`}
              width={112}
              height={112}
              className="h-28 w-28 rounded-full object-cover ring-4 ring-dira-amber/40"
            />
            <h3 className="mt-4 text-lg font-semibold text-dira-teal-deep dark:text-gray-50">{person.name}</h3>
            <p className="text-sm font-medium text-dira-amber-deep">{person.role}</p>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {person.bio.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
