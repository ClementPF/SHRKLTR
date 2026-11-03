package calc.exception;

import javax.servlet.http.HttpServletResponse;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.context.request.WebRequest;

/**
 *
 * @author danny
 */
@ControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(APIException.class)
    @ResponseBody
    public ErrorResponse handleAPIException(final APIException exception, final HttpServletResponse response) {
        response.setStatus(exception.getHttpStatus().value());
        return new ErrorResponse(exception.getMessage(), "");
    }

    @ExceptionHandler(Exception.class)
    public final ResponseEntity<ErrorResponse> handleAllExceptions(Exception ex, WebRequest request) {
        ErrorResponse errorResponse = new ErrorResponse(ex.getMessage(),
                request.getDescription(false));
        return new ResponseEntity<>(errorResponse, HttpStatus.INTERNAL_SERVER_ERROR);
    }
}
