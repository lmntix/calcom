import { authConfig } from "./config.edge";
import { signUp } from "@/cal/auth";
import { env } from "@/env";
import { type Prisma, type User, type CalAccount } from "@prisma/client";
import NextAuth from "next-auth";
import type { Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { db } from "prisma/client";
import { cache } from "react";
import "server-only";
import { z } from "zod";

// would've loved to use webcrypto apis (supported on edge as well), but: TypeError: randomBytes is not a function
// globalThis.crypto ??= import("node:crypto").then((m) => m.webcrypto);
// const Crypto = globalThis.crypto;
async function hash(password: string) {
  return new Promise<string>((resolve, reject) => {
    const salt = randomBytes(16).toString("hex");
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        console.error("Error hashing password", err);
        reject(err);
      }
      resolve(`${salt}.${derivedKey.toString("hex")}`);
    });
  });
}

async function compare(password: string, hash: string) {
  return new Promise<boolean>((resolve, reject) => {
    const [salt, hashKey] = hash.split(".") as [string, string];
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        console.error("Error comparing password", err);
        reject(err);
      }
      resolve(timingSafeEqual(Buffer.from(hashKey, "hex"), derivedKey));
    });
  });
}
export const LoginSchema = z.object({
  email: z.string().min(1).max(42),
  password: z.string().min(6).max(32),
});
export const SignupSchema = LoginSchema.merge(
  z.object({
    username: z.string().min(1).max(32),
    name: z.string().min(1).max(32),
    bio: z.string().min(1).max(500),
    // for all sidebaritems, let's create the zod schema:
    categories: z.preprocess((val) => {
      if (typeof val !== "string") return val; // should error
      return JSON.parse(val);
    }, z.array(z.string())),
    capabilities: z.preprocess((val) => {
      if (typeof val !== "string") return val; // should error
      return JSON.parse(val);
    }, z.array(z.string())),
    frameworks: z.preprocess((val) => {
      if (typeof val !== "string") return val; // should error
      return JSON.parse(val);
    }, z.array(z.string())),
    budgets: z.preprocess((val) => {
      if (typeof val !== "string") return val; // should error
      return JSON.parse(val);
    }, z.array(z.string())),
    languages: z.preprocess((val) => {
      if (typeof val !== "string") return val; // should error
      return JSON.parse(val);
    }, z.array(z.string())),
    regions: z.preprocess((val) => {
      if (typeof val !== "string") return val; // should error
      return JSON.parse(val);
    }, z.array(z.string())),
  })
);
type UserAfterSignUp = User & { calAccount?: CalAccount };
const {
  auth: uncachedAuth,
  handlers: { GET, POST },
  signIn,
  signOut,
  unstable_update,
} = NextAuth({
  ...authConfig,
  /**
   * [@calcom] 2️⃣ Attach the Credentials provider to NextAuth:
   */
  // NB: `withCal` isn't edge ready as it uses node-native apis; we therefore avoid importing it in `confige.edge.ts`
  providers: [
    Credentials({
      name: "Credentials",
      authorize: async (c) => {
        const credentials = LoginSchema.safeParse(c);

        if (!credentials.success) {
          console.error(
            `[auth] Invalid sign in submission because of missing credentials: ${credentials.error.errors.map((e) => e.message).join(", ")}`
          );
          // return `null` to indicate that the credentials are invalid
          return null;
        }

        let user: UserAfterSignUp | null = null;
        try {
          user = await db.user.findUnique({
            where: { email: credentials.data.email },
          });
          console.log(
            `[Auth.Credentials] Attempting to sign in with email ${credentials.data.email} -- is this actually correct??`
          );
          console.log(`[Auth.Credentials] User found? ${JSON.stringify(user, null, 2)}
          
          if (user): ${!!user}`);

          if (user) {
            // if user exists, this comes from our login page, let's check the password
            console.info(`User ${user.id} attempted login with password`);
            if (!user.hashedPassword) {
              console.debug(`OAuth User ${user.id} attempted signin with password`);
              return null;
            }
            const pwMatch = await compare(credentials.data.password, user.hashedPassword);
            if (!pwMatch) {
              console.debug(`User ${user.id} attempted login with bad password`);
              return null;
            }
            console.log("[auth.Credentials.authorize] User signed in successfully, returning user");
            return user;
          } else {
            // if user doesn't exist, this comes from our signup page w/ additional fields
            const signupData = SignupSchema.safeParse(c);
            if (!signupData.success) {
              console.error(
                `[auth] Invalid sign in submission because of missing signup data: ${signupData.error.errors
                  .map((e) => {
                    // return the path of the error with the message:
                    return `${e.path.join(".")} (${e.message}) -> '${e.code}'`;
                  })
                  .join(", ")}`
              );
              return null;
            }
            user = await db.user.create({
              data: {
                username: signupData.data.username,
                name: signupData.data.name,
                hashedPassword: await hash(credentials.data.password),
                bio: signupData.data.bio,
                email: credentials.data.email,
              },
            });
            if (!user) {
              console.error(`[auth] Unable to create user with email ${credentials.data.email}`);
              return null;
            }

            // now that we have the userId, connect the user to the filters:
            const selectedFilterOptions = [
              { filterOpdtionFieldIds: signupData.data.budgets, filterCategoryFieldId: "budgets" },
              { filterOpdtionFieldIds: signupData.data.capabilities, filterCategoryFieldId: "capabilities" },
              { filterOpdtionFieldIds: signupData.data.categories, filterCategoryFieldId: "categories" },
              { filterOpdtionFieldIds: signupData.data.frameworks, filterCategoryFieldId: "frameworks" },
              { filterOpdtionFieldIds: signupData.data.languages, filterCategoryFieldId: "languages" },
            ]
              .map(({ filterOpdtionFieldIds, filterCategoryFieldId }) => {
                return filterOpdtionFieldIds.map((fieldId) => {
                  if (!user?.id) return null;
                  return {
                    filterCategoryFieldId,
                    filterOptionFieldId: fieldId,
                    userId: user.id,
                  };
                });
              })
              // to filter out any null values:
              .filter(Boolean) as Prisma.FilterOptionsOnUserCreateManyInput[][];
            const data = selectedFilterOptions.flat();

            console.log(
              `[Auth.Credentials] Creating filter options for user ${user.id} along with the Cal signup`
            );
            const [_, toCreate] = await Promise.all([
              db.filterOptionsOnUser.createMany({
                data,
              }),
              // 👇 [@calcom] the `signUp` function creates a managed user with the cal platform api and handles basic setup (such as creating a default schedule)
              signUp({
                email: credentials.data.email,
                name: signupData.data.name,
                user: { id: user.id }, // we don't have the user id yet, so we'll use a placeholder
              }),
              // 👆 [@calcom]
            ]);

            console.log(
              `[Auth.Credentials] Created filter options for user ${user.id} along with the Cal signup. Updating hte dv before returning the user...`
            );
            // update the user with the cal account info:
            user = await db.user.update({ where: { id: user.id }, data: toCreate });

            return user satisfies UserAfterSignUp;
          }
        } catch (e) {
          console.error(e);
          return null;
        }
      },
    }),
  ],
});

export { signIn, signOut, GET, POST, unstable_update, uncachedAuth };

export const auth = cache(async () => {
  return await uncachedAuth();
});
export const currentUser = cache(async () => {
  const sesh = await auth();
  if (!sesh?.user.id) return null;
  return db.user.findUnique({
    where: { id: sesh.user.id },
  });
});
export const currentUserWithCalAccount = cache(async () => {
  const sesh = await auth();
  if (!sesh?.user.id) throw new Error("somehting's wrong here");
  return db.calAccount.findUnique({
    where: { email: sesh?.user?.email?.replace("@", `+${env.NEXT_PUBLIC_CAL_OAUTH_CLIENT_ID}@`) },
  });
});

export async function SignedIn(props: { children: (props: { user: Session["user"] }) => React.ReactNode }) {
  const sesh = await auth();
  return sesh?.user ? <>{props.children({ user: sesh.user })}</> : null;
}

export async function SignedOut(props: { children: React.ReactNode }) {
  const sesh = await auth();
  return sesh?.user ? null : <>{props.children}</>;
}

export async function CurrentUser(props: { children: (props: User) => React.ReactNode }) {
  const user = await currentUser();

  return !!user ? <>{props.children(user)}</> : null;
}
export async function CalAccount(props: { children: (props: CalAccount) => React.ReactNode }) {
  const calAccount = await currentUserWithCalAccount();
  return !!calAccount ? <>{props.children(calAccount)}</> : null;
}
