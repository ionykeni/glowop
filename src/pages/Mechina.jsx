import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import MechinaSpaces from "@/pages/MechinaSpaces";
import MechinaSleepingReport from "@/pages/MechinaSleepingReport";

export default function Mechina() {
  const [tab, setTab] = useState("spaces");

  return (
    <div className="px-4 pt-6" dir="rtl">
      <header className="max-w-6xl mx-auto mb-4 space-y-1">
        <h1 className="text-2xl font-heading font-semibold text-slate-800">ניהול מכינות</h1>
        <p className="text-sm text-slate-500">בקשות מרחבים ודיווח לינה בפועל</p>
      </header>

      <div className="max-w-6xl mx-auto">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="spaces">בקשות מרחבים</TabsTrigger>
            <TabsTrigger value="sleeping">דיווח לינה בפועל</TabsTrigger>
          </TabsList>
          <TabsContent value="spaces" className="mt-2">
            <MechinaSpaces />
          </TabsContent>
          <TabsContent value="sleeping" className="mt-2">
            <MechinaSleepingReport />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}