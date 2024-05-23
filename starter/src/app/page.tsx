import { Navigation } from "./_components/navigation";
import { HomeFilters } from "@/app/_components/home/filters";
import { Logo } from "@/app/_components/universal/logo";
import WelcomeCard from "@/app/_components/welcome-card";
import { SignedIn, SignedOut, currentUser } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader, LogIn } from "lucide-react";
import Link from "next/link";
import React, { Suspense } from "react";
import { Balancer } from "react-wrap-balancer";

export default async function Home() {
  const user = await currentUser();
  return (
    <>
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border/40 bg-muted/40 px-4 py-2 backdrop-blur lg:h-[60px] lg:px-6">
        <Logo href="/dashboard" />
        <Navigation />
        <div>
          {user ? (
            <Link href="/dashboard">
              <Button className="w-full">
                Dashboard
                <LogIn className="ml-1 size-4" />
              </Button>
            </Link>
          ) : (
            <Link href="/signup">
              <Button className="w-full">Sign Up</Button>
            </Link>
          )}
        </div>
      </header>
      <div className="flex-1">
        <div
          className="flex min-h-96 flex-col justify-center bg-cover bg-center bg-no-repeat py-20"
          style={{ backgroundImage: "url('/hero.jpg')" }}>
          <div className="container mt-16 flex flex-col items-center justify-center gap-12 px-4 py-6">
            <h1 className="font-display text-5xl font-extrabold tracking-tight text-white">
              <Balancer>Find your Cal.com Expert</Balancer>
            </h1>
            <div className="w-full max-w-2xl">
              <Input placeholder="Search for your expert, topic or more" className="h-14 w-full shadow-md" />
              {/*  <AutocompleteSearch options={professions} /> */}
            </div>
          </div>
        </div>
        <div className="flex-1">
          <div className="sm:my-10">
            <Suspense
              fallback={
                <div className="relative h-max w-full max-w-sm place-self-center">
                  <div className=" absolute inset-0 z-40 grid rounded-2xl bg-slate-900 text-white">
                    <Loader className="z-50 animate-spin place-self-center" />
                  </div>
                </div>
              }>
              <SignedIn>{({ user }) => <WelcomeCard username={user.name} />}</SignedIn>
              <SignedOut>
                <HomeFilters />
              </SignedOut>
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}
