import { MascotLoader } from "@/components/ui/mascot-loader"

export default function OrgLoading() {
  return (
    <div className="grid h-full place-items-center">
      <MascotLoader compact title="One moment" steps={["Getting things ready", "Almost there"]} />
    </div>
  )
}
