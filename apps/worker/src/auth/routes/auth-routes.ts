import {
  Router,
  type Request,
  type Response,
} from "express";

import {
  login,
  signup,
  type LoginRequest,
  type SignupRequest,
} from "../auth-service.js";

import {
  deleteSession,
  getAuthenticatedUser,
} from "../session.js";

/* ========================================
   ROUTER
======================================== */

const router: ReturnType<typeof Router> = Router();

/* ========================================
   SIGNUP
======================================== */

router.post(
  "/signup",
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const {
        email,
        password,
        fullName,
        workspaceName,
        websiteUrl,
      } = req.body as SignupRequest;

      const result =
        await signup({
          email,
          password,
          fullName,
          workspaceName,
          websiteUrl,
        });

      return res.status(201).json({
        success: true,
        data: result,
        metadata: {
          operation: "signup",
        },
      });
    } catch (error) {
      console.error(
        "Signup failed:",
        error
      );

      return res.status(400).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Signup failed.",
      });
    }
  }
);

/* ========================================
   LOGIN
======================================== */

router.post(
  "/login",
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const {
        email,
        password,
      } = req.body as LoginRequest;

      const result =
        await login({
          email,
          password,
        });

      return res.status(200).json({
        success: true,
        data: result,
        metadata: {
          operation: "login",
        },
      });
    } catch (error) {
      console.error(
        "Login failed:",
        error
      );

      return res.status(401).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Login failed.",
      });
    }
  }
);

/* ========================================
   ME
======================================== */

router.get(
  "/me",
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const authorization =
        req.headers.authorization;

      if (
        typeof authorization !==
        "string"
      ) {
        return res.status(401).json({
          success: false,
          error:
            "Authorization header is required.",
        });
      }

      const [scheme, token] =
        authorization.split(" ");

      if (
        scheme?.toLowerCase() !==
          "bearer" ||
        !token
      ) {
        return res.status(401).json({
          success: false,
          error:
            "Bearer session token is required.",
        });
      }

      const authenticated =
        await getAuthenticatedUser(
          token
        );

      if (!authenticated) {
        return res.status(401).json({
          success: false,
          error:
            "Invalid or expired session.",
        });
      }

      return res.status(200).json({
        success: true,
        data: authenticated,
        metadata: {
          operation: "me",
        },
      });
    } catch (error) {
      console.error(
        "Authentication check failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Authentication check failed.",
      });
    }
  }
);

/* ========================================
   LOGOUT
======================================== */

router.post(
  "/logout",
  async (
    req: Request,
    res: Response
  ) => {
    try {
      const authorization =
        req.headers.authorization;

      if (
        typeof authorization !==
        "string"
      ) {
        return res.status(401).json({
          success: false,
          error:
            "Authorization header is required.",
        });
      }

      const [scheme, token] =
        authorization.split(" ");

      if (
        scheme?.toLowerCase() !==
          "bearer" ||
        !token
      ) {
        return res.status(401).json({
          success: false,
          error:
            "Bearer session token is required.",
        });
      }

      await deleteSession(
        token
      );

      return res.status(200).json({
        success: true,
        data: {
          loggedOut: true,
        },
        metadata: {
          operation: "logout",
        },
      });
    } catch (error) {
      console.error(
        "Logout failed:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Logout failed.",
      });
    }
  }
);

/* ========================================
   EXPORT
======================================== */

export default router;