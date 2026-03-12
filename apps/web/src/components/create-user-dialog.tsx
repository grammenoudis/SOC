"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Eye, EyeOff, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";

interface CreateUserDialogProps {
  onCreated: () => void;
}

export function CreateUserDialog({ onCreated }: CreateUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("analyst");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*";
    const arr = new Uint32Array(16);
    crypto.getRandomValues(arr);
    setPassword(Array.from(arr, (v) => chars[v % chars.length]).join(""));
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await api.post("/users", { name, email, password, role });
      toast.success("User created");
      setName("");
      setEmail("");
      setPassword("");
      setRole("analyst");
      setOpen(false);
      onCreated();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" className="h-8 text-xs gap-1.5">
            <Plus className="size-3.5" />
            New User
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create User</DialogTitle>
          <DialogDescription>
            Add a new analyst or admin to the platform.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
              {error}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="user-name">Name</Label>
            <Input
              id="user-name"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              placeholder="john@lurkas.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-password">Password</Label>
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Input
                  id="user-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Minimum 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={generatePassword}
                title="Generate random password"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="user-role">Role</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole("analyst")}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  role === "analyst"
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Analyst
              </button>
              <button
                type="button"
                onClick={() => setRole("admin")}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  role === "admin"
                    ? "border-primary text-primary bg-primary/10"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Admin
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" size="sm" disabled={loading || !name.trim() || !email.trim() || !password.trim()}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
