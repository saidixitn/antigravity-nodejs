async function inspectAllSalary() {
  const u2 = "https://yescommunities.com/gfj/community-manager-in-training-la-vergne-tn-6ad71a24dd6a790397e93dc3";
  const res = await fetch(u2);
  const text = await res.text();
  let pos = 0;
  while ((pos = text.indexOf("50,000", pos)) !== -1) {
    console.log("--- Occurrence at", pos, "---");
    console.log(text.substring(Math.max(0, pos - 150), Math.min(text.length, pos + 150)));
    pos += 6;
  }
}
inspectAllSalary();
