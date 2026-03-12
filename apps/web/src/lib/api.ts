import axios from "axios";
import { toast } from "sonner";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.response?.data?.error;

    // don't toast on auth checks (session validation, etc)
    if (status === 401) {
      // redirect to login if session expired
      if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
        window.location.href = "/login";
      }
      return Promise.reject(error);
    }

    if (status === 403) {
      toast.error("Not authorized", {
        description: message || "You don't have permission to perform this action",
      });
    } else if (status === 404) {
      toast.error("Not found", {
        description: message || "The requested resource was not found",
      });
    } else if (status === 400) {
      toast.error("Invalid request", {
        description: message || "Please check your input and try again",
      });
    } else if (status && status >= 500) {
      toast.error("Server error", {
        description: "Something went wrong. Please try again later.",
      });
    } else if (!error.response) {
      toast.error("Connection error", {
        description: "Could not reach the server. Check your connection.",
      });
    }

    return Promise.reject(error);
  },
);

export default api;
