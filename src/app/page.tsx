import { redirect } from "next/navigation";

/**
 * The root of a Shreex deployment is the product, so it goes straight there.
 *
 * /shreex then routes by who you are: a platform administrator to the console,
 * everybody else to their business. The path is kept rather than flattened to
 * "/" because the migrations, the emails already sent and 232 links all name
 * it, and a redirect is cheaper than rewriting them a second time.
 */
export default function Root() {
  redirect("/shreex");
}
